package com.scaffoldfield.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate(), which builds the bridge.
        registerPlugin(NativePrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
