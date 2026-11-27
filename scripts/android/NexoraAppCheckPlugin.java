package com.devcedrick.nexoraaidrama;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;

@CapacitorPlugin(name = "NexoraAppCheck")
public class NexoraAppCheckPlugin extends Plugin {
    private volatile boolean initialized = false;

    @PluginMethod
    public void initialize(PluginCall call) {
        try {
            FirebaseAppCheck appCheck = FirebaseAppCheck.getInstance();
            appCheck.installAppCheckProviderFactory(
                PlayIntegrityAppCheckProviderFactory.getInstance()
            );
            appCheck.setTokenAutoRefreshEnabled(true);
            initialized = true;
            call.resolve();
        } catch (Exception error) {
            call.reject("Firebase App Check initialization failed.", error);
        }
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        if (!initialized) {
            call.reject("Firebase App Check has not been initialized.");
            return;
        }
        FirebaseAppCheck.getInstance().getAppCheckToken(false)
            .addOnSuccessListener(result -> {
                JSObject response = new JSObject();
                response.put("token", result.getToken());
                response.put("expireTimeMillis", result.getExpireTimeMillis());
                call.resolve(response);
            })
            .addOnFailureListener(error ->
                call.reject("Could not obtain a Firebase App Check token.", error)
            );
    }
}
