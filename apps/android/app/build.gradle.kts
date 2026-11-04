plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.irfan.companion"
    compileSdk = 35
    // Android Gradle's default AAPT ignore pattern drops directories named "_*".
    // Next.js static export requires assets/_next/** at runtime or WebView will be blank.
    androidResources {
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
    }
    defaultConfig { applicationId = "com.irfan.companion"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.5.0" }
    val signedStore=System.getenv("ANDROID_KEYSTORE_FILE")
    if(!signedStore.isNullOrBlank()){
        signingConfigs {
            create("clientRelease"){
                storeFile=file(signedStore)
                storeType = "JKS"
                storePassword=System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias=System.getenv("ANDROID_KEY_ALIAS")
                keyPassword=System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if(!signedStore.isNullOrBlank())signingConfig=signingConfigs.getByName("clientRelease")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}
dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("ai.picovoice:porcupine-android:4.0.2")
}
