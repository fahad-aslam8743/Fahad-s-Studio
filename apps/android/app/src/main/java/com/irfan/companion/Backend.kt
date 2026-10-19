package com.irfan.companion

import android.content.Context
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

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
                val text=result.split("\n\n").mapNotNull{block->
                    if(!block.contains("event: delta"))null else try{val line=block.lines().first{it.startsWith("data: ")};JSONObject(line.removePrefix("data: ")).optString("text")}catch(_:Exception){null}
                }.joinToString("")
                JSONObject().put("text",text)
            } else JSONObject(result)
        } finally { connection.disconnect() }
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
