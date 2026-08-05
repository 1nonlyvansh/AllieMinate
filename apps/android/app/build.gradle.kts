plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.alliminate.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.alliminate.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")

    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    implementation("androidx.biometric:biometric:1.1.0")
    // biometric:1.1.0 transitively pulls fragment:1.2.5 (2020) and nothing else in the graph asks for
    // newer, so Gradle resolves to that ancient version — which has a real bug where FragmentActivity's
    // legacy 16-bit request-code check rejects the random codes the modern Activity Result API generates
    // ("Can only use lower 16 bits for requestCode"), crashing on ANY permission-request launch. Force a
    // current version.
    implementation("androidx.fragment:fragment-ktx:1.8.2")
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
