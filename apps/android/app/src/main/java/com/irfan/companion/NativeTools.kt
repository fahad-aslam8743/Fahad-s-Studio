package com.irfan.companion

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.content.Context
import android.content.ComponentName
import android.util.Patterns
import org.json.JSONArray
import org.json.JSONObject

class NativeTools(private val activity:MainActivity) {
 private val settings=activity.getSharedPreferences("tool_policies",Context.MODE_PRIVATE)
 private val minimum=mapOf(
     "open_app" to "SAFE","settings_panel" to "SAFE","volume" to "CONFIRM",
     "screen_brightness" to "CONFIRM","flashlight" to "CONFIRM","dnd" to "CONFIRM",
     "call" to "CONFIRM","sms" to "CONFIRM","notifications_read" to "CONFIRM",
     "accessibility_click" to "CONFIRM","open_website" to "SAFE",
     "video_download" to "CONFIRM","ui_elements" to "CONFIRM",
     "notification_dismiss" to "CONFIRM")
 val names get()=minimum.keys.toList()
 fun risk(name:String):String {
   val base=minimum[name]?:return "BLOCKED"
   val chosen=settings.getString(name,base)?:base
   return if(base=="CONFIRM"&&chosen=="SAFE")"CONFIRM" else chosen
 }
 fun setRisk(name:String,value:String):JSONObject {
   require(name in minimum){"Unknown tool"}
   require(value in setOf("SAFE","CONFIRM","BLOCKED")){"Unknown risk"}
   require(!(minimum[name]=="CONFIRM"&&value=="SAFE")){"Sensitive actions require at least CONFIRM"}
   settings.edit().putString(name,value).apply()
   return JSONObject().put("name",name).put("risk",risk(name))
 }
 fun list():JSONArray{
   val a=JSONArray();for(name in names)a.put(JSONObject().put("name",name).put("risk",risk(name)).put("minimum",minimum[name]));return a
 }
 fun run(name:String,args:JSONObject):JSONObject {
   if(name !in minimum)throw IllegalArgumentException("Unsupported Android tool")
   if(risk(name)=="BLOCKED")throw IllegalStateException("Blocked in permissions")
   when(name){
    "open_app"->{
      val q=args.optString("name").trim()
      require(q.isNotBlank()&&q.length<=100){"Specify an app name"}
      val pm=activity.packageManager
      val launcher=Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val installed=pm.queryIntentActivities(launcher,0).map{
        Triple(it.loadLabel(pm).toString(),it.activityInfo.packageName,it.activityInfo.name)
      }.filter{it.first.contains(q,true)}.distinctBy{it.second+"."+it.third}
      if(installed.isEmpty())return JSONObject().put("status","not_found").put("query",q)
      val exact=installed.filter{it.first.equals(q,true)}
      val candidates=if(exact.isNotEmpty())exact else installed
      if(candidates.size>1&&!args.has("package")){
        val options=JSONArray();candidates.take(12).forEach{options.put(JSONObject().put("name",it.first).put("package",it.second))}
        return JSONObject().put("status","ambiguous").put("choices",options)
      }
      val selected=candidates.find{it.second==args.optString("package")}?:candidates.singleOrNull()
         ?:return JSONObject().put("status","ambiguous")
      val launch=pm.getLaunchIntentForPackage(selected.second)?:return JSONObject().put("status","launcher_not_available")
      activity.startActivity(launch)
      return JSONObject().put("status","opened").put("app",selected.first)
    }
    "settings_panel"->{
      val what=args.optString("panel")
      val action=when(what){
       "wifi"->if(Build.VERSION.SDK_INT>=29)Settings.Panel.ACTION_WIFI else Settings.ACTION_WIFI_SETTINGS
       "bluetooth"->Settings.ACTION_BLUETOOTH_SETTINGS
       "airplane"->Settings.ACTION_AIRPLANE_MODE_SETTINGS
       "dnd"->Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS
       "accessibility"->Settings.ACTION_ACCESSIBILITY_SETTINGS
       "notifications"->Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
       "display"->Settings.ACTION_DISPLAY_SETTINGS
       else->throw IllegalArgumentException("Unknown Settings panel")
      }
      activity.startActivity(Intent(action))
      return JSONObject().put("status","opened_settings").put("note","The user must operate the system toggle; silent toggling is not permitted.")
    }
    "volume"->{
      val audio=activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      when(args.optString("action")){
       "up"->audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,AudioManager.ADJUST_RAISE,AudioManager.FLAG_SHOW_UI)
       "down"->audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,AudioManager.ADJUST_LOWER,AudioManager.FLAG_SHOW_UI)
       "mute"->audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,AudioManager.ADJUST_MUTE,AudioManager.FLAG_SHOW_UI)
       "unmute"->audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,AudioManager.ADJUST_UNMUTE,AudioManager.FLAG_SHOW_UI)
       else->throw IllegalArgumentException("Invalid volume action")
      }
      return JSONObject().put("status","completed")
    }
    "screen_brightness"->{
      val pct=args.optInt("percent",-1);require(pct in 0..100){"Brightness must be 0–100"}
      if(!Settings.System.canWrite(activity)){
        activity.startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS,Uri.parse("package:"+activity.packageName)))
        return JSONObject().put("status","permission_required").put("permission","Modify system settings")
      }
      Settings.System.putInt(activity.contentResolver,Settings.System.SCREEN_BRIGHTNESS,(pct*255/100).coerceAtLeast(1))
      return JSONObject().put("status","completed").put("percent",pct)
    }
    "flashlight"->{
      if(activity.checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){
        activity.requestPermissions(arrayOf(Manifest.permission.CAMERA),101)
        return JSONObject().put("status","permission_required").put("permission","Camera")
      }
      val camera=activity.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val id=camera.cameraIdList.firstOrNull{camera.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE)==true}
          ?:return JSONObject().put("status","unsupported").put("reason","No flashlight hardware")
      camera.setTorchMode(id,args.optBoolean("enabled",true))
      return JSONObject().put("status","completed")
    }
    "dnd"->{
      val manager=activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if(!manager.isNotificationPolicyAccessGranted){
        activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
        return JSONObject().put("status","permission_required").put("permission","Do Not Disturb access")
      }
      manager.setInterruptionFilter(if(args.optBoolean("enabled",true))NotificationManager.INTERRUPTION_FILTER_NONE else NotificationManager.INTERRUPTION_FILTER_ALL)
      return JSONObject().put("status","completed")
    }
    "call"->{
      val number=args.optString("number")
      require(number.matches(Regex("[+0-9 ()-]{3,30}"))){"Invalid number"}
      activity.startActivity(Intent(Intent.ACTION_DIAL,Uri.parse("tel:"+Uri.encode(number))))
      return JSONObject().put("status","dialer_opened").put("note","User must press Call in system dialer.")
    }
    "sms"->{
      val number=args.optString("number");val message=args.optString("message")
      require(number.matches(Regex("[+0-9 ()-]{3,30}"))&&message.length<=2000){"Invalid SMS"}
      val intent=Intent(Intent.ACTION_SENDTO,Uri.parse("smsto:"+Uri.encode(number))).putExtra("sms_body",message)
      activity.startActivity(intent)
      return JSONObject().put("status","sms_composer_opened").put("note","User must press Send inside SMS app.")
    }
    "notifications_read"->{
      val enabled=Settings.Secure.getString(activity.contentResolver,"enabled_notification_listeners")?:""
      if(!enabled.contains(activity.packageName))return JSONObject().put("status","permission_required").put("permission","Notification access")
      return JSONObject().put("status","completed").put("notifications",JarvisNotificationService.snapshot())
    }
    "notification_dismiss"->{
      val key=args.optString("key")
      require(key.isNotBlank()){"Provide notification key"}
      if(!JarvisNotificationService.active) return JSONObject().put("status","permission_required").put("permission","Notification access")
      val dismissed=JarvisNotificationService.dismiss(key)
      return JSONObject().put("status",if(dismissed)"completed" else "failed")
    }
    "accessibility_click"->{
      val target=args.optString("label")
      require(target.length in 2..100){"Provide exact visible label"}
      val service=JarvisAccessibilityService.active?:return JSONObject().put("status","permission_required").put("permission","Accessibility service")
      val clicked=service.clickVisible(target)
      return JSONObject().put("status",if(clicked)"completed" else "control_not_found")
    }
    "ui_elements"->{
      val service=JarvisAccessibilityService.active?:return JSONObject().put("status","permission_required").put("permission","Accessibility service")
      val limit=args.optInt("limit",80)
      val elements=service.getVisibleElements(limit)
      return JSONObject().put("status","completed").put("count",elements.length())
          .put("elements",elements)
          .put("foreground_package",JarvisAccessibilityService.lastWindowPackage)
    }
    "open_website"->{
      val target=Uri.parse(args.optString("url"))
      require(target.scheme=="https"&&target.host!=null){"Only HTTPS sites can be opened"}
      activity.startActivity(Intent(Intent.ACTION_VIEW,target))
      return JSONObject().put("status","opened")
    }
    "video_download"->{
      val target=Uri.parse(args.optString("url"))
      require(target.scheme=="https"&&target.host?.let{it=="fal.media"||it.endsWith(".fal.media")||it.endsWith(".fal.ai")}==true){"Only trusted fal video URLs can be downloaded"}
      val request=android.app.DownloadManager.Request(target)
          .setTitle("Irfan video result").setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
          .setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS,"irfan-"+System.currentTimeMillis()+".mp4")
      val manager=activity.getSystemService(Context.DOWNLOAD_SERVICE) as android.app.DownloadManager
      return JSONObject().put("status","download_started").put("downloadId",manager.enqueue(request))
    }
   }
   return JSONObject().put("status","unsupported")
 }
}
