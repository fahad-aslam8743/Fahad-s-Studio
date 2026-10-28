package com.irfan.companion

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedDeque

class JarvisNotificationService: NotificationListenerService() {
 companion object {
    @Volatile var active:Boolean=false
    private val recent=ConcurrentLinkedDeque<JSONObject>()

    /** Returns a JSONArray of up to 50 most recent notifications. */
    fun snapshot():JSONArray {
        val out=JSONArray()
        recent.take(50).forEach{ out.put(it) }
        return out
    }

    /** Dismiss a notification by its key. Returns true if the service attempted dismissal. */
    fun dismiss(key:String):Boolean {
        val service=activeInstance ?: return false
        try { service.cancelNotification(key); return true } catch(_:Exception){ return false }
    }

    @Volatile private var activeInstance:JarvisNotificationService?=null
 }

 override fun onListenerConnected() {
    active=true
    activeInstance=this
 }

 override fun onNotificationPosted(sbn:StatusBarNotification?) {
    if(sbn==null || sbn.packageName=="com.irfan.companion") return
    val n=sbn.notification ?: return
    val title=n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.take(160) ?: ""
    val text=n.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.take(400) ?: ""
    if(title.isBlank() && text.isBlank()) return
    recent.addFirst(JSONObject()
        .put("app",sbn.packageName)
        .put("title",title)
        .put("text",text)
        .put("time",sbn.postTime)
        .put("key",sbn.key))
    while(recent.size>50) recent.pollLast()
 }

 override fun onNotificationRemoved(sbn:StatusBarNotification?) {
    if(sbn==null) return
    recent.removeAll{ it.optString("key")==sbn.key }
 }

 override fun onListenerDisconnected() {
    active=false
    activeInstance=null
    recent.clear()
 }
}
