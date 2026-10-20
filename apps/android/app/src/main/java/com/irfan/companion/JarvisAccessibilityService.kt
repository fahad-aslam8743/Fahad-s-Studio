package com.irfan.companion

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class JarvisAccessibilityService: AccessibilityService(){
 companion object { @Volatile var active:JarvisAccessibilityService?=null }
 override fun onServiceConnected() {active=this}
 override fun onAccessibilityEvent(event:AccessibilityEvent?) {}
 override fun onInterrupt() {}
 override fun onDestroy(){if(active===this)active=null;super.onDestroy()}
 fun clickVisible(text:String):Boolean {
    if(text.length !in 2..100)return false
    val root=rootInActiveWindow?:return false
    val queue=ArrayDeque<AccessibilityNodeInfo>()
    queue.add(root)
    var inspected=0
    while(queue.isNotEmpty()&&inspected<250){
      val node=queue.removeFirst();inspected++
      try {
        val candidate=node.text?.toString()?:node.contentDescription?.toString()?:""
        if(candidate.equals(text,ignoreCase=true)&&node.isVisibleToUser&&node.isEnabled){
          var current:AccessibilityNodeInfo?=node
          var climbs=0
          while(current!=null&&climbs<4){
            if(current.isClickable)return current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            current=current.parent;climbs++
          }
        }
        for(i in 0 until node.childCount){node.getChild(i)?.let{queue.add(it)}}
      }catch (_:Exception){}
    }
    return false
 }
}
