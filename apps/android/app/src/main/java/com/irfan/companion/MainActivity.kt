package com.irfan.companion

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.view.ViewGroup
import android.webkit.*
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.lang.ref.WeakReference
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity: ComponentActivity() {
 companion object { var foreground:WeakReference<MainActivity>?=null }
 private val work=Executors.newSingleThreadExecutor()
 private val handler=Handler(Looper.getMainLooper())
 private lateinit var web:WebView
 private lateinit var backend:Backend
 private lateinit var tools:NativeTools
 private var speechId:String?=null
 private var wakeModelRequest:String?=null
 private var voice:TextToSpeech?=null
 private var ttsReady=false
 private var pendingSpeech:JSONObject?=null
 private var visible=false
 private val seen=mutableSetOf<String>()
 private val modelPicker=registerForActivityResult(ActivityResultContracts.OpenDocument()){uri->
    val id=wakeModelRequest;wakeModelRequest=null
    if(id!=null){
      if(uri==null)reply(id,JSONObject().put("cancelled",true))
      else try {
        val output=java.io.File(filesDir,"irfan_custom.ppn")
        contentResolver.openInputStream(uri)?.use{input->output.outputStream().use{dest->input.copyTo(dest)}} ?:throw IllegalStateException("File unavailable")
        require(output.length() in 1..5_000_000){"Custom wake model must be smaller than 5 MB"}
        reply(id,JSONObject().put("modelReady",true))
      }catch(e:Exception){error(id,e)}
    }
 }
 private val recognizer=registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { response->
     val text=response.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull().orEmpty()
     val id=speechId;speechId=null
     if(id!=null)reply(id,JSONObject().put("text",text))
     else emit("irfan-speech",JSONObject().put("text",text))
 }
 private fun reply(id:String,value:JSONObject?=null,error:String?=null){
     val packet=JSONObject().put("id",id).put("ok",error==null)
     if(error==null)packet.put("value",value?:JSONObject())else packet.put("error",error.take(300))
     runOnUiThread {if(::web.isInitialized)web.evaluateJavascript("window.__irfanNativeReply&&window.__irfanNativeReply("+packet.toString()+")",null)}
 }
 private fun emit(name:String,detail:JSONObject){
     runOnUiThread {if(::web.isInitialized)web.evaluateJavascript("window.dispatchEvent(new CustomEvent("+JSONObject.quote(name)+",{detail:"+detail.toString()+"}))",null)}
 }
 private fun error(id:String,e:Throwable){android.util.Log.w("IrfanCompanion",e.javaClass.simpleName);reply(id,null,e.message?:"Action unavailable")}
 private fun speakNow(args:JSONObject):JSONObject {
   val text=args.optString("text").trim().take(3000)
   require(text.isNotEmpty()){"Nothing to speak"}
   val requested=args.optString("language","auto").lowercase(Locale.ROOT)
   val language=if(requested=="auto"){
     when {
       Regex("[\\u0600-\\u06FF]").containsMatchIn(text)->"ur"
       Regex("[\\u0900-\\u097F]").containsMatchIn(text)->"hi"
       else->Locale.getDefault().language.ifBlank{"en"}
     }
   } else requested
   val locale=when(language){
     "ur"->Locale.forLanguageTag("ur-PK")
     "hi"->Locale.forLanguageTag("hi-IN")
     "ar"->Locale.forLanguageTag("ar")
     "es"->Locale.forLanguageTag("es")
     "fr"->Locale.forLanguageTag("fr")
     "de"->Locale.forLanguageTag("de")
     "zh"->Locale.forLanguageTag("zh-CN")
     "ja"->Locale.forLanguageTag("ja")
     else->Locale.forLanguageTag("en-US")
   }
   val tts=voice?:throw IllegalStateException("Android speech engine is unavailable")
   val languageStatus=tts.setLanguage(locale)
   if(languageStatus==TextToSpeech.LANG_MISSING_DATA||languageStatus==TextToSpeech.LANG_NOT_SUPPORTED){
     tts.language=Locale.getDefault()
   } else {
     val gender=args.optString("gender","female").lowercase(Locale.ROOT)
     val matching=tts.voices?.firstOrNull{v->
       v.locale.language==locale.language &&
       (v.name.contains(gender,true)||v.features.any{it.contains("gender="+gender,true)})
     }
     if(matching!=null)tts.voice=matching
   }
   when(args.optString("persona","calm")){
     "energetic"->tts.setSpeechRate(1.08f)
     "romantic"->tts.setSpeechRate(0.96f)
     else->tts.setSpeechRate(1.0f)
   }
   val result=tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,"jarvis-"+System.currentTimeMillis())
   if(result==TextToSpeech.ERROR)throw IllegalStateException("Android could not start speech output")
   return JSONObject().put("spoken",true).put("language",locale.toLanguageTag())
 }

 override fun onCreate(savedInstanceState:Bundle?){
     super.onCreate(savedInstanceState)
     backend=Backend(this);tools=NativeTools(this)
     voice=TextToSpeech(this){status->
       if(status==TextToSpeech.SUCCESS){
         ttsReady=true
         voice?.language=Locale.getDefault()
         pendingSpeech?.let{args->try{speakNow(args)}catch(e:Exception){emit("irfan-tts-error",JSONObject().put("message",e.message?:"Speech unavailable"))}}
         pendingSpeech=null
       }
     }
     val body=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setBackgroundColor(0xff030815.toInt())}
     val bar=LinearLayout(this)
     fun button(label:String,click:()->Unit){bar.addView(Button(this).apply{text=label;setOnClickListener{click()}},LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f))}
     button("Pair"){pairDialog()};button("Permissions"){permissionsDialog()};button("Listen"){speech(null)};button("Wake"){wakeToggle()}
     body.addView(bar)
     val loader=WebViewAssetLoader.Builder().setDomain("appassets.androidplatform.net")
         .addPathHandler("/",WebViewAssetLoader.AssetsPathHandler(this)).build()
     web=WebView(this)
     web.settings.javaScriptEnabled=true
     web.settings.domStorageEnabled=true
     web.settings.allowFileAccess=false
     web.settings.allowContentAccess=false
     web.settings.allowFileAccessFromFileURLs=false
     web.settings.allowUniversalAccessFromFileURLs=false
     web.settings.javaScriptCanOpenWindowsAutomatically=false
     web.settings.setSupportMultipleWindows(false)
     web.settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
     web.settings.mediaPlaybackRequiresUserGesture=true
     web.webChromeClient=object:WebChromeClient(){
       override fun onPermissionRequest(p:PermissionRequest){
         runOnUiThread{
          if(p.origin.host=="appassets.androidplatform.net"&&
             checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED&&
             p.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE))p.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
          else p.deny()
         }
       }
     }
     web.webViewClient=object:WebViewClient(){
       override fun shouldInterceptRequest(v:WebView,r:WebResourceRequest):WebResourceResponse?{
         val u=r.url
         if(u.scheme=="https"&&u.host=="appassets.androidplatform.net")return loader.shouldInterceptRequest(u)
         return WebResourceResponse("text/plain","UTF-8",403,"Forbidden",mapOf("Cache-Control" to "no-store"),ByteArrayInputStream(ByteArray(0)))
       }
       override fun shouldOverrideUrlLoading(v:WebView,r:WebResourceRequest):Boolean{
         if(r.url.host=="appassets.androidplatform.net")return false
         if(r.url.scheme=="https")startActivity(Intent(Intent.ACTION_VIEW,r.url))
         return true
       }
     }
     web.addJavascriptInterface(object{
       @JavascriptInterface fun post(raw:String){
         if(raw.length>200000)return
         val msg=try{JSONObject(raw)}catch(_:Exception){return}
         val id=msg.optString("id").take(90)
         if(id.isEmpty())return
         val args=msg.optJSONObject("args")?:JSONObject()
         when(msg.optString("method")){
          "session"->reply(id,JSONObject().put("paired",backend.paired).put("deviceId",backend.deviceId).put("platform","android"))
          "session.unpair"->runOnUiThread{AlertDialog.Builder(this@MainActivity).setTitle("Unpair this phone?").setMessage("This clears the Android device token from Keystore storage. You may need a new PC pairing code.").setPositiveButton("Unpair"){_,_->backend.unpair();reply(id,JSONObject().put("paired",false));emit("irfan-paired",JSONObject().put("paired",false))}.setNegativeButton("Cancel"){_,_->reply(id,JSONObject().put("cancelled",true))}.show()}
          "pair"->work.execute{try{reply(id,backend.pair(args.optString("code")))}catch(e:Exception){error(id,e)}}
          "api"->work.execute{try{reply(id,backend.request(args.optString("route"),args.optString("verb","GET"),args.optJSONObject("body")))}catch(e:Exception){error(id,e)}}
          "tools.list"->reply(id,JSONObject().put("tools",tools.list()))
          "tools.run"->runOnUiThread{approveTool(args.optString("name"),args.optJSONObject("args")?:JSONObject()){reply(id,it)}}
          "tools.policy"->runOnUiThread{try{reply(id,tools.setRisk(args.getString("name"),args.getString("risk")))}catch(e:Exception){error(id,e)}}
          "permissions.open"->runOnUiThread{permissionsDialog();reply(id,JSONObject().put("opened",true))}
          "speech"->runOnUiThread{speech(id)}
          "speak"->runOnUiThread{
             if(!ttsReady){pendingSpeech=JSONObject(args.toString());reply(id,JSONObject().put("queued",true))}
             else try{reply(id,speakNow(args))}catch(e:Exception){error(id,e)}
          }
          "wake.selectModel"->runOnUiThread{wakeModelRequest=id;modelPicker.launch(arrayOf("*/*"))}
          "wake.start"->runOnUiThread{
             val key=args.optString("accessKey")
             if(key.isNotEmpty())SecureStore(this@MainActivity).put("porcupine_key",key)
             wakeStart();reply(id,JSONObject().put("requested",true))
          }
          "wake.stop"->runOnUiThread{stopService(Intent(this@MainActivity,WakeWordService::class.java));reply(id,JSONObject().put("stopped",true))}
          else->reply(id,null,"Unknown native action")
         }
       }
     },"IrfanNative")
     body.addView(web,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1f))
     setContentView(body)
     web.loadUrl("https://appassets.androidplatform.net/index.html")
 }
 fun approveTool(name:String,args:JSONObject,forceConfirm:Boolean=false,done:(JSONObject)->Unit){
   val risk=tools.risk(name)
   if(risk=="BLOCKED"){done(JSONObject().put("status","blocked"));return}
   fun run(){try{done(tools.run(name,args))}catch(e:Exception){done(JSONObject().put("status","error").put("reason",e.message?:"Unavailable"))}}
   if(forceConfirm||risk=="CONFIRM"){
     AlertDialog.Builder(this).setTitle("Approve Jarvis action: "+name)
       .setMessage(args.toString(2).take(1400)+"\n\nApprove this single action?")
       .setPositiveButton("Approve"){_,_->run()}
       .setNegativeButton("Deny"){_,_->done(JSONObject().put("status","rejected"))}
       .setCancelable(false).show()
   }else run()
 }
 private fun pairDialog(){
   val edit=EditText(this).apply{hint="Paste code from Windows Jarvis"}
   AlertDialog.Builder(this).setTitle("Pair this phone").setView(edit)
     .setMessage("Code created on your PC expires in 3 minutes. It is single-use.")
     .setPositiveButton("Pair"){_,_->
       work.execute{try{backend.pair(edit.text.toString().trim());emit("irfan-paired",JSONObject().put("paired",true))}
       catch(e:Exception){runOnUiThread{Toast.makeText(this,e.message?:"Pairing failed",Toast.LENGTH_LONG).show()}}}
     }.setNegativeButton("Cancel",null).show()
 }
 private fun permissionsDialog(){
   val names=tools.names.toTypedArray()
   AlertDialog.Builder(this).setTitle("Tool permissions")
     .setItems(names.map{it+" — "+tools.risk(it)}.toTypedArray()){_,i->
       AlertDialog.Builder(this).setTitle(names[i]).setItems(arrayOf("SAFE","CONFIRM","BLOCKED")){_,choice->
         try{tools.setRisk(names[i],arrayOf("SAFE","CONFIRM","BLOCKED")[choice])}
         catch(e:Exception){Toast.makeText(this,e.message,Toast.LENGTH_LONG).show()}
       }.show()
     }.setPositiveButton("System permissions"){_,_->
       val labels=arrayOf("Notification access","Accessibility","System settings","Do Not Disturb")
       val actions=arrayOf(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS,Settings.ACTION_ACCESSIBILITY_SETTINGS,Settings.ACTION_MANAGE_WRITE_SETTINGS,Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
       AlertDialog.Builder(this).setItems(labels){_,i->startActivity(Intent(actions[i]))}.show()
     }.setNegativeButton("Close",null).show()
 }
 fun speech(id:String?){
   if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
     requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO),99)
     if(id!=null)reply(id,null,"Grant microphone permission, then retry")
     return
   }
   speechId=id
   try{recognizer.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM))}
   catch(e:Exception){if(id!=null)reply(id,null,"No speech recognition app available")}
 }
 private fun wakeToggle(){if(WakeWordService.active)stopService(Intent(this,WakeWordService::class.java))else wakeStart()}
 private fun wakeStart(){
   if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO),100);return}
   if(SecureStore(this).get("porcupine_key").isNullOrBlank()){Toast.makeText(this,"Enter Picovoice AccessKey in the Android tab",Toast.LENGTH_LONG).show();return}
   startForegroundService(Intent(this,WakeWordService::class.java))
 }
 private val polling=object:Runnable{
   override fun run(){
     if(visible&&backend.paired)work.execute{
       try{
         val rows=backend.call("/relay/poll").optJSONArray("items")?:org.json.JSONArray()
         for(i in 0 until rows.length()){
           val task=rows.getJSONObject(i);val id=task.optString("id")
           if(!seen.add(id))continue
           runOnUiThread{approveTool(task.optString("tool"),task.optJSONObject("args")?:JSONObject(),true){result->
             work.execute{
               try{backend.call("/relay/complete","POST",JSONObject().put("id",id)
                 .put("status",if(result.optString("status") in setOf("completed","opened","opened_settings","dialer_opened","sms_composer_opened","download_started"))"completed" else "rejected")
                 .put("detail",result.toString()))}catch(_:Exception){}
             }
           }}
         }
       }catch(_:Exception){}
     }
     if(visible)handler.postDelayed(this,10000)
   }
 }
 override fun onResume(){super.onResume();foreground=WeakReference(this);visible=true;handler.removeCallbacks(polling);handler.postDelayed(polling,10000)}
 override fun onPause(){visible=false;handler.removeCallbacks(polling);foreground=null;super.onPause()}
 override fun onDestroy(){visible=false;handler.removeCallbacks(polling);voice?.shutdown();web.destroy();work.shutdownNow();super.onDestroy()}
}
