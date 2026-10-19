package com.irfan.companion

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedDeque

class JarvisNotificationService: NotificationListenerService() {
 companion object {
    private val recent=ConcurrentLinkedDeque<JSONObject>()
    fun snapshot():JSONArray {
        val out=JSONArray()
        recent.take(30).forEach{out.put(it)}
        return out
    }
 }
 override fun onNotificationPosted(sbn:StatusBarNotification?) {
    if(sbn==null||sbn.packageName=="com.irfan.companion")return
    val n=sbn.notification ?: return
    val title=n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.take(160) ?: ""
    val text=n.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.take(400) ?: ""
    if(title.isBlank()&&text.isBlank())return
    recent.addFirst(JSONObject().put("app",sbn.packageName).put("title",title).put("text",text).put("time",sbn.postTime))
    while(recent.size>40)recent.pollLast()
 }
 override fun onListenerDisconnected() { recent.clear() }
}
