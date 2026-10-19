plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.irfan.companion"
    compileSdk = 35
    defaultConfig { applicationId = "com.irfan.companion"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.5.0" }
    buildTypes { release { isMinifyEnabled = false } }
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
