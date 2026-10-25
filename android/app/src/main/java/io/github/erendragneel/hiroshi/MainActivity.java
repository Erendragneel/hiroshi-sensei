package io.github.erendragneel.hiroshi;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import android.widget.Toast;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** Only the packaged, origin-restricted UI receives this native bridge. */
public final class MainActivity extends ComponentActivity {
    private static final String ORIGIN = "appassets.androidplatform.net";
    private WebView web;
    private HiroshiAuth auth;
    private HiroshiInference inference;
    private final ExecutorService requests = Executors.newFixedThreadPool(3);
    private final ConcurrentHashMap<String, String> active = new ConcurrentHashMap<>();
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingBackup;
    private volatile boolean closed;
    private final ActivityResultLauncher<Intent> openDocument = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            if (fileCallback == null) return;
            Uri uri = result.getResultCode() == RESULT_OK && result.getData()!=null ? result.getData().getData() : null;
            fileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri}); fileCallback = null;
        });
    private final ActivityResultLauncher<String> saveDocument = registerForActivityResult(
        new ActivityResultContracts.CreateDocument("application/json"), uri -> {
            byte[] data = pendingBackup; pendingBackup = null;
            if (uri == null || data == null) return;
            background(() -> {
                try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
                    if (stream == null) throw new java.io.IOException();
                    stream.write(data);
                } catch (Exception ignored) { runOnUiThread(() -> showError("The backup could not be saved. Please try another location.")); }
            });
        });

    @SuppressLint("SetJavaScriptEnabled") // Packaged files only, no remote frames or scripts.
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try { initializeGame(); }
        catch (RuntimeException | LinkageError failure) { showStartupFailure(failure); }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void initializeGame() {
        auth = new HiroshiAuth(getApplicationContext());
        inference = new HiroshiInference(() -> auth.accessToken());
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this); root.addView(web); setContentView(root);
        // API 35+ no longer creates window decor inside setDecorFitsSystemWindows.
        // Attach content before asking PhoneWindow for its insets controller.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(),getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);
        ViewCompat.setOnApplyWindowInsetsListener(root,(view,insets)->{
            androidx.core.graphics.Insets p=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout()|WindowInsetsCompat.Type.ime());
            view.setPadding(p.left,p.top,p.right,p.bottom);return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(root);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false); settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        android.webkit.CookieManager.getInstance().setAcceptCookie(false);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder().addPathHandler("/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request){
                Uri url=request.getUrl();
                if("https".equals(url.getScheme())&&ORIGIN.equals(url.getHost())) {
                    WebResourceResponse resource=assets.shouldInterceptRequest(url);
                    if(resource!=null)return resource;
                }
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",null,new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri url=request.getUrl();
                if("https".equals(url.getScheme())&&ORIGIN.equals(url.getHost())&&"/index.html".equals(url.getPath()))return false;
                if(request.isForMainFrame()&&"https".equals(url.getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,url));}catch(android.content.ActivityNotFoundException ignored){showError("No browser is available to open this link.");}
                return true;
            }
            @Override public boolean onRenderProcessGone(WebView view,android.webkit.RenderProcessGoneDetail detail){
                inference.cancel();auth.cancelSignIn();root.removeView(view);view.destroy();web=null;
                new AlertDialog.Builder(MainActivity.this).setMessage("Android closed the game screen. Reopen Hiroshi to continue with your saved progress.").setPositiveButton("Close",(dialog,which)->finish()).setCancelable(false).show();return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams parameters){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
                try{openDocument.launch(intent);}catch(Exception ignored){fileCallback.onReceiveValue(null);fileCallback=null;return false;}return true;
            }
        });
        web.addJavascriptInterface(new Bridge(),"HiroshiAndroid");
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){
            if(web!=null)web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.close();return true;}return false;})()",value->{if(!"true".equals(value))finish();});else finish();
        }});
        web.loadUrl("https://"+ORIGIN+"/index.html");
        background(()->{try{if(auth.status().optBoolean("planEnabled")){inference.listModels();connectionChanged();}}catch(Exception ignored){connectionChanged();}});
    }

    private void background(Runnable work) {
        if(closed)return;
        try { requests.execute(work); }
        catch(RejectedExecutionException ignored) { /* The Activity closed before this queued callback. */ }
    }

    /** A local, message-free diagnostic report; nothing is uploaded automatically. */
    void showStartupFailure(Throwable failure) {
        if(inference!=null)inference.cancel();
        if(web!=null){web.removeJavascriptInterface("HiroshiAndroid");web.destroy();web=null;}
        String report=StartupDiagnostics.describe(failure,BuildConfig.VERSION_NAME,android.os.Build.VERSION.SDK_INT);
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);
        int padding=(int)(24*getResources().getDisplayMetrics().density);
        panel.setPadding(padding,padding*2,padding,padding);panel.setBackgroundColor(0xFFF6F5F0);
        TextView title=new TextView(this);title.setText("Hiroshi could not open");title.setTextSize(23);title.setTextColor(0xFF305348);
        TextView explanation=new TextView(this);explanation.setText("Your saved game has not been reset. Copy the error details below to report this startup problem.");explanation.setTextSize(16);explanation.setPadding(0,padding,0,padding);
        TextView details=new TextView(this);details.setText(report);details.setTextSize(12);details.setTextIsSelectable(true);
        Button copy=new Button(this);copy.setText("Copy error details");copy.setOnClickListener(view->{
            ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
            if(clipboard!=null){clipboard.setPrimaryClip(ClipData.newPlainText("Hiroshi startup report",report));Toast.makeText(this,"Error details copied",Toast.LENGTH_SHORT).show();}
        });
        Button close=new Button(this);close.setText("Close");close.setOnClickListener(view->finish());
        panel.addView(title);panel.addView(explanation);panel.addView(copy);panel.addView(close);panel.addView(details);
        setContentView(panel);
    }

    private JSONObject status() throws Exception {
        JSONObject result=auth.status();
        boolean enabled=result.optBoolean("planEnabled");
        result.put("configured",enabled&&!inference.selectedModel().isEmpty());
        result.put("provider",enabled?"chatgpt":"none");result.put("model",inference.selectedModel());
        if(enabled&&inference.selectedModel().isEmpty())result.put("message","Your account is signed in. Connect again to check model access, or check ChatGPT usage settings. No conversation has been verified yet.");
        return result;
    }
    private void reply(String id,int status,JSONObject data){
        active.remove(id);
        runOnUiThread(()->{if(web!=null&&!closed)web.evaluateJavascript("window.__hiroshiReply&&window.__hiroshiReply("+JSONObject.quote(id)+","+status+","+data+");",null);});
    }
    private void error(String id,int status,String code,String message){
        try{reply(id,status,new JSONObject().put("error",new JSONObject().put("code",code).put("message",message)));}catch(Exception ignored){ }
    }
    private void connectionChanged(){runOnUiThread(()->{if(web!=null&&!closed)web.evaluateJavascript("window.__hiroshiConnectionChanged&&window.__hiroshiConnectionChanged();",null);});}
    private void showError(String message){if(!isFinishing()&&!closed)new AlertDialog.Builder(this).setMessage(message).setPositiveButton("OK",null).show();}
    private final class Bridge {
        @JavascriptInterface public void request(String id,String action,String raw){
            if(closed||id==null||!id.matches("[0-9]{1,12}")||raw==null||raw.length()>120000)return;
            if(active.size()>=8){error(id,429,"BUSY","Please finish the current request first.");return;}
            active.put(id,action);
            if("connect".equals(action)){
                runOnUiThread(()->auth.signIn(MainActivity.this,(safe,error)->{
                    if(closed)return;
                    if(error!=null){MainActivity.this.error(id,401,"SIGN_IN_REQUIRED",error);return;}
                    background(()->{try{inference.clearModels();if(safe.optBoolean("planEnabled"))inference.listModels();reply(id,200,status());}
                        catch(HiroshiInference.InferenceException e){MainActivity.this.error(id,e.status,e.code,e.getMessage());}
                        catch(Exception e){MainActivity.this.error(id,503,"CONNECTION_UNAVAILABLE","Sign-in finished, but model access could not be checked. Please reconnect or check your ChatGPT usage.");}connectionChanged();});
                }));return;
            }
            background(()->{
                try {
                    JSONObject payload=new JSONObject(raw);
                    switch(action){
                        case "status": reply(id,200,status());break;
                        case "models": reply(id,200,new JSONObject().put("models",inference.currentModels()).put("selected",inference.selectedModel()));break;
                        case "select-model": inference.selectModel(payload.optString("model"));reply(id,200,status());break;
                        case "chat": reply(id,200,inference.chat(payload));break;
                        case "disconnect": inference.cancel();auth.disconnect();inference.clearModels();reply(id,200,status());connectionChanged();break;
                        default: error(id,404,"UNKNOWN_REQUEST","This app request is not supported.");
                    }
                }catch(HiroshiInference.InferenceException e){error(id,e.status,e.code,e.getMessage());}
                catch(HiroshiAuth.AuthException e){error(id,401,"SIGN_IN_REQUIRED",e.getMessage());connectionChanged();}
                catch(Exception e){error(id,503,"CONNECTION_UNAVAILABLE","Hiroshi could not connect. Your saved game is safe; check your internet connection and try again.");}
            });
        }
        @JavascriptInterface public void cancel(String id){String action=active.remove(id);if("chat".equals(action))inference.cancel();if("connect".equals(action))auth.cancelSignIn();}
        @JavascriptInterface public void saveBackup(String name,String text){
            if(closed||name==null||text==null||text.length()>2*1024*1024)return;
            if(!name.matches("hiroshi-sensei-backup-[0-9-]+\\.json"))name="hiroshi-sensei-backup.json";
            final String filename=name;
            runOnUiThread(()->{if(pendingBackup!=null)return;pendingBackup=text.getBytes(StandardCharsets.UTF_8);saveDocument.launch(filename);});
        }
    }
    @Override protected void onDestroy(){
        closed=true;if(inference!=null)inference.cancel();if(auth!=null)auth.close();requests.shutdownNow();
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        if(web!=null){web.removeJavascriptInterface("HiroshiAndroid");web.destroy();web=null;}
        super.onDestroy();
    }
}
