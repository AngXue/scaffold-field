package com.scaffoldfield.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Routes the app's print action to Android's print framework.
 *
 * `window.print()` is a no-op inside a WebView, so on the tablet the
 * "打印 / PDF" button silently did nothing. This hands the current WebView to
 * PrintManager, which offers real printers as well as "Save as PDF", so the
 * material list can still leave the app on paper or as a PDF file.
 *
 * The `@media print` rules in `src/index.css` decide what lands on the page.
 */
@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        final String jobName = call.getString("jobName", "架算");
        final WebView webView = getBridge().getWebView();
        final PrintManager printManager =
                (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);

        if (printManager == null) {
            call.reject("系统的打印服务不可用");
            return;
        }

        getActivity().runOnUiThread(() -> {
            PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
            printManager.print(jobName, adapter, new PrintAttributes.Builder().build());
            call.resolve();
        });
    }
}
