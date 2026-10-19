package com.irfan.companion

import ai.picovoice.porcupine.Porcupine
import ai.picovoice.porcupine.PorcupineManager
import ai.picovoice.porcupine.PorcupineManagerCallback
import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class WakeWordService:Service(){
 companion object { @Volatile var active=false }
 private var manager:PorcupineManager?=null
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onCreate(){
    super.onCreate()
    val channel=NotificationChannel("wakeword","Jarvis microphone",NotificationManager.IMPORTANCE_LOW)
    (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
 }
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
    if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){stopSelf();return START_NOT_STICKY}
    val notification=Notification.Builder(this,"wakeword")
      .setContentTitle("Jarvis wake word enabled")
      .setContentText("Microphone is active. Tap app to disable.")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentIntent(PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build()
    startForeground(101,notification)
    if(active)return START_NOT_STICKY
    val key=SecureStore(this).get("porcupine_key")
    if(key.isNullOrBlank()){stopSelf();return START_NOT_STICKY}
    try{
      manager=PorcupineManager.Builder().setAccessKey(key)
        .setKeyword(Porcupine.BuiltInKeyword.JARVIS)
        .build(this,PorcupineManagerCallback { _ ->
          MainActivity.foreground?.get()?.runOnUiThread{
            MainActivity.foreground?.get()?.speech(null)
          }
        })
      manager?.start();active=true
    }catch(e:Exception){android.util.Log.e("JarvisWake","Wake listener unavailable",e);stopSelf()}
    return START_NOT_STICKY
 }
 override fun onDestroy(){
   active=false
   try{manager?.stop();manager?.delete()}catch(_:Exception){}
   manager=null
   super.onDestroy()
 }
}
