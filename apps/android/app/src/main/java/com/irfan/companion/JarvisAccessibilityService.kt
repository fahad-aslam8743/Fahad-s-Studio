package com.irfan.companion

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

class JarvisAccessibilityService: AccessibilityService(){
 companion object {
   @Volatile var active:JarvisAccessibilityService?=null
   @Volatile var lastWindowPackage:String=""
 }

 override fun onServiceConnected() { active=this }

 override fun onAccessibilityEvent(event:AccessibilityEvent?) {
   if(event==null) return
   when(event.eventType){
     AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
     AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
       event.packageName?.toString()?.let{ lastWindowPackage=it }
     }
   }
 }

 override fun onInterrupt() {}

 override fun onUnbind(intent:android.content.Intent?):Boolean {
   if(active===this) active=null
   return super.onUnbind(intent)
 }

 override fun onDestroy(){
   if(active===this) active=null
   super.onDestroy()
 }

 /**
  * Finds a visible UI element by text or content-description and performs a click.
  * Walks up to 4 ancestors to find a clickable parent if the node itself isn't clickable.
  */
 fun clickVisible(label:String):Boolean {
   if(label.length !in 2..100) return false
   val root=rootInActiveWindow ?: return false
   val queue=ArrayDeque<AccessibilityNodeInfo>()
   queue.add(root)
   var inspected=0
   while(queue.isNotEmpty() && inspected<250){
     val node=queue.removeFirst(); inspected++
     try {
       val nodeText=node.text?.toString() ?: ""
       val nodeDesc=node.contentDescription?.toString() ?: ""
       val match=nodeText.equals(label,ignoreCase=true) || nodeDesc.equals(label,ignoreCase=true)
       if(match && node.isVisibleToUser && node.isEnabled){
         var current:AccessibilityNodeInfo?=node
         var climbs=0
         while(current!=null && climbs<4){
           if(current.isClickable) return current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
           current=current.parent; climbs++
         }
       }
       for(i in 0 until node.childCount){ node.getChild(i)?.let{ queue.add(it) } }
     }catch(_:Exception){}
   }
   return false
 }

 /**
  * Returns a JSONArray of visible UI elements with text, contentDescription, className, and bounds.
  * BFS traversal, capped at [limit] results (default 80, max 200).
  */
 fun getVisibleElements(limit:Int=80):JSONArray {
   val cap=limit.coerceIn(1,200)
   val result=JSONArray()
   val root=rootInActiveWindow ?: return result
   val queue=ArrayDeque<AccessibilityNodeInfo>()
   queue.add(root)
   var inspected=0
   val bounds=Rect()
   while(queue.isNotEmpty() && inspected<500 && result.length()<cap){
     val node=queue.removeFirst(); inspected++
     try {
       if(!node.isVisibleToUser){ continue }
       val text=node.text?.toString()?.take(200) ?: ""
       val desc=node.contentDescription?.toString()?.take(200) ?: ""
       if(text.isNotBlank() || desc.isNotBlank()){
         node.getBoundsInScreen(bounds)
         result.put(JSONObject().apply{
           put("text",text)
           put("contentDescription",desc)
           put("className",node.className?.toString() ?: "")
           put("bounds","${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}")
           put("clickable",node.isClickable)
           put("enabled",node.isEnabled)
         })
       }
       for(i in 0 until node.childCount){ node.getChild(i)?.let{ queue.add(it) } }
     }catch(_:Exception){}
   }
   return result
 }
}
