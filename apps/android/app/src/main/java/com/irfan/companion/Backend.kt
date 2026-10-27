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
    fun call(route: String,method: String="GET",body: JSONObject?=null,authenticate: Boolean=true): JSONObject {
        require(route.startsWith("/")&&!route.startsWith("//")&&!route.contains("..")&&route.length<300){"Invalid route"}
        require(method in setOf("GET","POST","PUT","DELETE"))
        val connection=(URL(base+route).openConnection() as HttpURLConnection)
        connection.requestMethod=method;connection.connectTimeout=12000;connection.readTimeout=45000
        connection.setRequestProperty("Accept","application/json")
        if(authenticate) {
            val bearer=store.get("device_token") ?: throw IllegalStateException("Pair your phone first")
            connection.setRequestProperty("Authorization","Bearer "+bearer)
        }
        if(body!=null) {
            connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json")
            val bytes=body.toString().toByteArray(Charsets.UTF_8)
            require(bytes.size<=200000){"Request too large"}
            connection.outputStream.use{it.write(bytes)}
        }
        return try {
            val code=connection.responseCode
            val stream=if(code in 200..299) connection.inputStream else connection.errorStream
            val result=stream?.bufferedReader()?.use{it.readText().take(800000)} ?: "{}"
            if(code !in 200..299)throw IllegalStateException("Server $code: "+JSONObject(result).optString("error","Request failed"))
            if(result.trimStart().startsWith("["))JSONObject().put("items",JSONArray(result))
            else if(connection.contentType?.contains("text/event-stream")==true){
                val chunks=StringBuilder()
                var serverError:String?=null
                for(block in result.split("\n\n")){
                    val event=block.lineSequence().firstOrNull{it.startsWith("event: ")}?.removePrefix("event: ")?.trim()
                    val line=block.lineSequence().firstOrNull{it.startsWith("data: ")}?.removePrefix("data: ") ?: continue
                    try {
                        val payload=JSONObject(line)
                        when(event){
                            "delta" -> chunks.append(payload.optString("text"))
                            "done" -> if(chunks.isEmpty())chunks.append(payload.optString("text"))
                            "error" -> serverError=payload.optString("message","JARVIS could not generate a response")
                        }
                    } catch(_:Exception) {}
                }
                if(serverError!=null)throw IllegalStateException(serverError)
                if(chunks.isEmpty())throw IllegalStateException("JARVIS returned an empty response. Check the connection and try again.")
                JSONObject().put("text",chunks.toString())
            } else JSONObject(result)
        } catch (_:UnknownHostException) { throw IllegalStateException("Internet connection unavailable. Jarvis will reconnect when online.") }
          catch (_:SocketTimeoutException) { throw IllegalStateException("The server took too long. Please try again.") }
          catch (_:ConnectException) { throw IllegalStateException("Jarvis cannot reach the server. Check your connection.") }
          finally { connection.disconnect() }
    }
    fun pair(code: String): JSONObject {
        val result=call("/devices/redeem","POST",JSONObject().put("code",code).put("label","Irfan Android"),false)
        store.put("device_token",result.getString("token"))
        store.put("device_id",result.getString("deviceId"))
        return JSONObject().put("paired",true).put("deviceId",deviceId)
    }
    fun request(route:String,method:String="GET",body: JSONObject?=null):JSONObject {
        val permitted=route.startsWith("/chat")||route.startsWith("/memories")||route.startsWith("/email/")||
            route.startsWith("/video/")||route.startsWith("/tts")||route.startsWith("/stt")||
            route.startsWith("/relay/")||route.startsWith("/devices")||route.startsWith("/personas")
        require(permitted){"Mobile API route unavailable"}
        return call(route,method,body)
    }
}
