package com.irfan.companion

import android.content.Context
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.net.UnknownHostException
import java.net.SocketTimeoutException
import java.net.ConnectException

class Backend(context: Context) {
    private val store = SecureStore(context)
    private val base = "https://fahad-s-studio.notxfahad.workers.dev"
    val paired get() = !store.get("device_token").isNullOrBlank()
    val deviceId get() = store.get("device_id") ?: ""
    fun unpair(){store.remove("device_token");store.remove("device_id")}

    fun call(route: String,method: String="GET",body: JSONObject?=null,authenticate: Boolean=true,onChatDelta: ((String)->Unit)?=null): JSONObject {
        require(route.startsWith("/")&&!route.startsWith("//")&&!route.contains("..")&&route.length<300){"Invalid route"}
        require(method in setOf("GET","POST","PUT","DELETE"))
        val connection=(URL(base+route).openConnection() as HttpURLConnection)
        connection.requestMethod=method
        connection.connectTimeout=12000
        connection.readTimeout=when {
            route=="/chat" -> 150000
            route.startsWith("/tts") || route.startsWith("/stt") -> 90000
            else -> 45000
        }
        connection.setRequestProperty("Accept","application/json, text/event-stream")
        if(authenticate) {
            val bearer=store.get("device_token") ?: throw IllegalStateException("Pair your phone first")
            connection.setRequestProperty("Authorization","Bearer "+bearer)
        }
        if(body!=null) {
            connection.doOutput=true
            connection.setRequestProperty("Content-Type","application/json")
            val bytes=body.toString().toByteArray(Charsets.UTF_8)
            require(bytes.size<=200000){"Request too large"}
            connection.outputStream.use{it.write(bytes)}
        }
        return try {
            val code=connection.responseCode
            val stream=if(code in 200..299) connection.inputStream else connection.errorStream
            if(code !in 200..299) {
                val errorBody=stream?.bufferedReader(Charsets.UTF_8)?.use{it.readText().take(800000)} ?: "{}"
                val message=try{JSONObject(errorBody).optString("error",errorBody.take(300))}catch(_:Exception){errorBody.take(300)}
                throw IllegalStateException("Server $code: "+message.ifBlank{"Request failed"})
            }
            if(connection.contentType?.contains("text/event-stream",ignoreCase=true)==true) {
                val answer=StringBuilder()
                var eventName=""
                val data=StringBuilder()
                var streamError:String?=null
                fun consumeEvent(){
                    if(data.isNotEmpty()){
                        try {
                            val payload=JSONObject(data.toString())
                            when(eventName){
                                "delta" -> {
                                    val chunk=payload.optString("text")
                                    answer.append(chunk)
                                    onChatDelta?.invoke(chunk)
                                }
                                "done" -> if(answer.isEmpty()) answer.append(payload.optString("text"))
                                "error" -> streamError=payload.optString("message","Chat response unavailable")
                            }
                        } catch(_:Exception) {
                            if(eventName=="error")streamError="Chat response unavailable"
                        }
                    }
                    eventName=""
                    data.setLength(0)
                }
                stream?.bufferedReader(Charsets.UTF_8)?.use{reader->
                    while(true){
                        val line=reader.readLine() ?: break
                        when {
                            line.isEmpty() -> consumeEvent()
                            line.startsWith("event:") -> eventName=line.substringAfter(":").trim()
                            line.startsWith("data:") -> {
                                if(data.isNotEmpty())data.append('\n')
                                data.append(line.substringAfter(":").trimStart())
                            }
                        }
                    }
                    consumeEvent()
                }
                if(streamError!=null)throw IllegalStateException(streamError!!)
                JSONObject().put("text",answer.toString())
            } else {
                val result=stream?.bufferedReader(Charsets.UTF_8)?.use{it.readText().take(800000)} ?: "{}"
                if(result.trimStart().startsWith("["))JSONObject().put("items",JSONArray(result))
                else JSONObject(result)
            }
        } catch (_:UnknownHostException) { throw IllegalStateException("Internet connection unavailable. Jarvis will reconnect when online.") }
          catch (_:SocketTimeoutException) { throw IllegalStateException(if(route=="/chat")"Chat timed out while waiting for the AI service. Please retry." else "The server took too long. Please try again.") }
          catch (_:ConnectException) { throw IllegalStateException("Jarvis cannot reach the server. Check your connection.") }
          finally { connection.disconnect() }
    }

    fun pair(code: String): JSONObject {
        val result=call("/devices/redeem","POST",JSONObject().put("code",code).put("label","Irfan Android"),false)
        store.put("device_token",result.getString("token"))
        store.put("device_id",result.getString("deviceId"))
        return JSONObject().put("paired",true).put("deviceId",deviceId)
    }
    fun request(route:String,method:String="GET",body: JSONObject?=null,onChatDelta: ((String)->Unit)?=null):JSONObject {
        val permitted=route.startsWith("/chat")||route.startsWith("/memories")||route.startsWith("/tasks")||
            route.startsWith("/email/")||route.startsWith("/video/")||route.startsWith("/tts")||
            route.startsWith("/stt")||route.startsWith("/relay/")||route.startsWith("/devices")||
            route.startsWith("/personas")
        require(permitted){"Mobile API route unavailable"}
        return call(route,method,body,onChatDelta=onChatDelta)
    }
}
