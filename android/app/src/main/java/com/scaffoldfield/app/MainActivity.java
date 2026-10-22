package com.scaffoldfield.app;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate(), which builds the bridge.
        registerPlugin(NativePrintPlugin.class);
        super.onCreate(savedInstanceState);
        // Android 15+ enforces edge-to-edge. Inset the native content once so the
        // same viewport-based web layout also fits system bars and cutouts.
        // The window resizes for IME itself; adding IME padding would shrink twice.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets safe = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        WindowCompat.getInsetsController(getWindow(), content).setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(getWindow(), content).setAppearanceLightNavigationBars(true);
        ViewCompat.requestApplyInsets(content);
    }
}
