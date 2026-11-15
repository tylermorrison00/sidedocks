plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.sidedock.app"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.sidedock.app"
        minSdk = 24
        targetSdk = 34
        versionCode = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        create("release") {
            val ksPath = (project.findProperty("keystorePath") as String?) ?: System.getenv("ANDROID_KEYSTORE_PATH")
            val ksPass = (project.findProperty("keystorePassword") as String?) ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            val keyAliasVal = (project.findProperty("keyAlias") as String?) ?: System.getenv("ANDROID_KEY_ALIAS")
            val keyPassVal = (project.findProperty("keyPassword") as String?) ?: System.getenv("ANDROID_KEY_PASSWORD")
            if (!ksPath.isNullOrBlank() && file(ksPath).isFile) {
                storeFile = file(ksPath)
                storePassword = ksPass
                keyAlias = keyAliasVal
                keyPassword = keyPassVal
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            // NEVER fall back to debug signing: a debug-signed release APK
            // cannot install over the user's release-signed app
            // ("package conflicts with an existing package"). Fail loudly
            // instead so CI never ships a wrongly-signed APK again.
            val ksPath = (project.findProperty("keystorePath") as String?)
                ?: System.getenv("ANDROID_KEYSTORE_PATH")
            if (ksPath.isNullOrBlank() || !file(ksPath).isFile) {
                throw GradleException("Release keystore missing at '$ksPath' — check ANDROID_KEYSTORE_BASE64 secret in GitHub Actions.")
            }
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ""
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
tasks.register<Copy>("copyWebAssets") {
    from("${rootProject.projectDir}/../renderer") { into("renderer") }
    from("${rootProject.projectDir}/../assets") { into("assets") }
    into("${projectDir}/src/main/assets")
}
tasks.named("preBuild") { dependsOn("copyWebAssets") }
dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
