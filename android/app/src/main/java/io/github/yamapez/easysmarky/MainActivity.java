package io.github.yamapez.easysmarky;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebRequestError;

import java.util.List;

/**
 * Smarky を開き、easysmarky を自動で読み込むだけの小さなブラウザ。
 *
 * このアプリ自身は Smarky の API を1つも呼ばない。パスワードもアクセストークンも
 * 読まない・保存しない・書き換えない。覚えるのは学校の接頭辞(URLの一部)だけ。
 * easysmarky 本体(下書き保存まで・提出はしない)は assets/extension/inject.js がページに差し込む。
 */
public class MainActivity extends Activity {
    private static final String TAG = "easysmarky";
    private static final String PREFS = "easysmarky";
    private static final String KEY_SCHOOL_PREFIX = "schoolPrefix";
    private static final String EXTENSION_URI = "resource://android/assets/extension/";
    private static final String EXTENSION_ID = "easysmarky@yamapez.github.io";
    private static final int ACCENT = Color.rgb(0x21, 0x96, 0xC9);

    /** エンジンはプロセスに1つだけ作れる。画面を作り直しても使い回す */
    private static GeckoRuntime sRuntime;

    private SharedPreferences prefs;
    private GeckoSession session;
    private Prompts prompts;
    private boolean canGoBack;
    /** 最後に読み込もうとしたURL(失敗したときの「もう一度読み込む」に使う) */
    private String lastRequestedUrl;
    /** 直前の読み込みが失敗して、エラーの画面を出したか */
    private boolean errorWasShown;

    private ProgressBar progressBar;
    private View setupView;
    private EditText setupInput;
    private TextView setupError;
    private View errorView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        GeckoView geckoView = new GeckoView(this);
        root.addView(geckoView, match());

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setVisibility(View.GONE);
        root.addView(progressBar, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP));

        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, match());

        setupView = buildSetupView();
        setupView.setVisibility(View.GONE);
        root.addView(setupView, match());

        setContentView(root);
        applyInsets(root);
        registerBackHandler();

        if (sRuntime == null) {
            sRuntime = GeckoRuntime.create(getApplicationContext(), new GeckoRuntimeSettings.Builder()
                    .consoleOutput(BuildConfig.DEBUG)
                    .remoteDebuggingEnabled(BuildConfig.DEBUG)
                    .aboutConfigEnabled(false)
                    .build());
        }

        prompts = new Prompts(this);
        session = new GeckoSession();
        session.setNavigationDelegate(new Navigation());
        session.setProgressDelegate(new Progress());
        session.setContentDelegate(new Content());
        session.setPromptDelegate(prompts);
        session.setPermissionDelegate(new Permissions());
        session.open(sRuntime);
        geckoView.setSession(session);

        String fromIntent = urlFromIntent(getIntent());
        String prefix = prefs.getString(KEY_SCHOOL_PREFIX, null);
        if (fromIntent != null) {
            openSmarkyUrl(fromIntent);
        } else if (prefix != null) {
            load(SmarkyUrls.startUrl(prefix));
        } else {
            showSetup(true);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = urlFromIntent(intent);
        if (url != null) openSmarkyUrl(url);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == Prompts.REQUEST_FILE) prompts.onFileResult(resultCode, data);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (session != null) session.close();
    }

    // ---- 読み込み ----

    /** 共有(SEND)やリンク(VIEW)で渡された Smarky のURL。無ければ null */
    private static String urlFromIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) return null;
        switch (intent.getAction()) {
            case Intent.ACTION_SEND:
                return SmarkyUrls.findIn(intent.getStringExtra(Intent.EXTRA_TEXT));
            case Intent.ACTION_VIEW:
                // デバッグ版だけ、動作確認用に任意のページを開ける(adb から明示的に渡したときに限る)
                if (BuildConfig.DEBUG && intent.getBooleanExtra("debugAnyUrl", false)) {
                    return intent.getDataString();
                }
                return SmarkyUrls.findIn(intent.getDataString());
            default:
                return null;
        }
    }

    /**
     * 利用者が渡した Smarky のURLを開く。生徒の画面のURLなら学校の接頭辞を覚え、
     * 次からの起動先(レポートの一覧)にする。それ以外は、渡されたURLをそのまま開く。
     */
    private void openSmarkyUrl(String url) {
        showSetup(false);
        // 渡されたURLは、パスも含めてそのまま開く(特定のレポートや再設定のリンクを落とさないため)
        String prefix = SmarkyUrls.schoolPrefix(url);
        if (prefix != null) rememberSchoolPrefix(prefix);
        load(url);
    }

    private void rememberSchoolPrefix(String prefix) {
        if (prefix.equals(prefs.getString(KEY_SCHOOL_PREFIX, null))) return;
        prefs.edit().putString(KEY_SCHOOL_PREFIX, prefix).apply();
    }

    /**
     * ページを読み込む。内蔵拡張(easysmarky の差し込み)の登録が済んでから読み込む。
     * 先に読み込むと、最初のページにだけ easysmarky が入らない。
     */
    private void load(String url) {
        lastRequestedUrl = url;
        errorView.setVisibility(View.GONE);
        final GeckoSession target = session;
        sRuntime.getWebExtensionController().ensureBuiltIn(EXTENSION_URI, EXTENSION_ID).accept(
                extension -> loadNow(target, url),
                error -> {
                    Log.e(TAG, "内蔵拡張を登録できませんでした", error);
                    loadNow(target, url);
                });
    }

    private void loadNow(GeckoSession target, String url) {
        if (target != session || isDestroyed()) return;
        if (!target.isOpen()) target.open(sRuntime);
        target.loadUri(url);
    }

    private void reload() {
        errorView.setVisibility(View.GONE);
        if (lastRequestedUrl != null && errorWasShown) {
            errorWasShown = false;
            load(lastRequestedUrl);
        } else {
            session.reload();
        }
    }

    private final class Navigation implements GeckoSession.NavigationDelegate {
        @Override
        public void onCanGoBack(GeckoSession s, boolean value) {
            canGoBack = value;
        }

        @Override
        public void onLocationChange(GeckoSession s, String url,
                                     List<GeckoSession.PermissionDelegate.ContentPermission> perms,
                                     Boolean hasUserGesture) {
            // ログイン後などに生徒の画面へ移ったら、その学校を次からの起動先として覚える
            String prefix = SmarkyUrls.schoolPrefix(url);
            if (prefix != null) rememberSchoolPrefix(prefix);
        }

        @Override
        public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s, LoadRequest request) {
            String uri = request.uri == null ? "" : request.uri;
            boolean web = uri.startsWith("https://") || uri.startsWith("http://") || uri.startsWith("about:");
            if (web) lastRequestedUrl = uri.startsWith("about:") ? lastRequestedUrl : uri;
            // intent: や market: など、ほかのアプリを起動するリンクは開かない
            return GeckoResult.fromValue(web ? AllowOrDeny.ALLOW : AllowOrDeny.DENY);
        }

        /** 新しいウィンドウ(target=_blank など)は、同じ画面で開く。このアプリにタブは無い */
        @Override
        public GeckoResult<GeckoSession> onNewSession(GeckoSession s, String uri) {
            if (uri != null && (uri.startsWith("https://") || uri.startsWith("http://"))) s.loadUri(uri);
            return null;
        }

        @Override
        public GeckoResult<String> onLoadError(GeckoSession s, String uri, WebRequestError error) {
            Log.w(TAG, "読み込みに失敗: " + uri + " (" + error.code + ")");
            if (uri != null) lastRequestedUrl = uri;
            errorWasShown = true;
            errorView.setVisibility(View.VISIBLE);
            return null;
        }
    }

    private final class Progress implements GeckoSession.ProgressDelegate {
        @Override
        public void onProgressChange(GeckoSession s, int progress) {
            progressBar.setProgress(progress);
            progressBar.setVisibility(progress > 0 && progress < 100 ? View.VISIBLE : View.GONE);
        }

        @Override
        public void onPageStop(GeckoSession s, boolean success) {
            progressBar.setVisibility(View.GONE);
            if (success) {
                errorWasShown = false;
                errorView.setVisibility(View.GONE);
            }
        }
    }

    /**
     * ページからの許可の求め(通知・位置情報など)。Smarky の利用に要らないので、音の出ない
     * 自動再生だけ通して、あとは断る。カメラ・マイクは GeckoView の既定どおり断られる。
     */
    private static final class Permissions implements GeckoSession.PermissionDelegate {
        @Override
        public GeckoResult<Integer> onContentPermissionRequest(GeckoSession s, ContentPermission perm) {
            boolean allow = perm.permission == PERMISSION_AUTOPLAY_INAUDIBLE;
            if (BuildConfig.DEBUG) Log.d(TAG, "許可の求め: " + perm.permission + " → " + (allow ? "許可" : "拒否"));
            return GeckoResult.fromValue(allow ? ContentPermission.VALUE_ALLOW : ContentPermission.VALUE_DENY);
        }
    }

    private final class Content implements GeckoSession.ContentDelegate {
        /** ページを描いているプロセスが落ちた・OSに止められた。開き直して同じページを読み込む */
        @Override
        public void onCrash(GeckoSession s) {
            recover();
        }

        @Override
        public void onKill(GeckoSession s) {
            recover();
        }

        private void recover() {
            // OAuth の戻りURL(使い捨てのコード付き)を開き直さないよう、学校の一覧を優先する
            String prefix = prefs.getString(KEY_SCHOOL_PREFIX, null);
            if (prefix != null) load(SmarkyUrls.startUrl(prefix));
            else if (lastRequestedUrl != null) load(lastRequestedUrl);
        }
    }

    // ---- 戻るキー ----

    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    /** Android 12 以前はこちらが呼ばれる */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        boolean hasSchool = prefs.getString(KEY_SCHOOL_PREFIX, null) != null;
        if (setupView.getVisibility() == View.VISIBLE) {
            // 学校が決まっていれば「URLを変更」をやめて元の画面へ。まだなら、閉じるしかない
            if (hasSchool || lastRequestedUrl != null) showSetup(false);
            else finish();
        } else if (errorView.getVisibility() != View.VISIBLE && canGoBack) {
            session.goBack();
        } else {
            showMenu();
        }
    }

    /** 戻る先が無いときに出すメニュー。画面に常駐するバーを置かない代わり */
    private void showMenu() {
        CharSequence[] items = {
                getString(R.string.menu_reload),
                getString(R.string.menu_change_url),
                getString(R.string.menu_exit),
        };
        new AlertDialog.Builder(this)
                .setTitle(getString(R.string.app_name) + " " + BuildConfig.VERSION_NAME)
                .setItems(items, (dialog, which) -> {
                    if (which == 0) reload();
                    else if (which == 1) showSetup(true);
                    else finish();
                })
                .show();
    }

    // ---- 最初の画面(学校のURL) ----

    private void showSetup(boolean show) {
        setupView.setVisibility(show ? View.VISIBLE : View.GONE);
        setupError.setVisibility(View.GONE);
        if (!show) {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            imm.hideSoftInputFromWindow(setupInput.getWindowToken(), 0);
            setupInput.setText("");
        }
    }

    private void submitSetup() {
        String url = SmarkyUrls.findIn(setupInput.getText().toString());
        if (url == null) {
            setupError.setVisibility(View.VISIBLE);
            return;
        }
        openSmarkyUrl(url);
    }

    private void pasteIntoSetup() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = clipboard.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) return;
        CharSequence text = clip.getItemAt(0).coerceToText(this);
        if (text == null) return;
        setupInput.setText(text.toString().trim());
        setupInput.setSelection(setupInput.length());
        setupError.setVisibility(View.GONE);
    }

    private View buildSetupView() {
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(24), dp(40), dp(24), dp(24));

        column.addView(text(R.string.setup_title, 22, Color.rgb(0x22, 0x22, 0x22), true), block(0));
        column.addView(text(R.string.setup_body, 15, Color.rgb(0x44, 0x44, 0x44), false), block(12));

        setupInput = new EditText(this);
        setupInput.setHint(R.string.setup_hint);
        setupInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        setupInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        setupInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        setupInput.setOnEditorActionListener((v, actionId, event) -> {
            submitSetup();
            return true;
        });
        column.addView(setupInput, block(24));

        setupError = text(R.string.setup_error, 13, Color.rgb(0xC6, 0x28, 0x28), false);
        setupError.setVisibility(View.GONE);
        column.addView(setupError, block(4));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        Button paste = new Button(this);
        paste.setText(R.string.setup_paste);
        paste.setOnClickListener(v -> pasteIntoSetup());
        Button open = new Button(this);
        open.setText(R.string.setup_open);
        paintPrimary(open);
        open.setOnClickListener(v -> submitSetup());
        buttons.addView(paste, new LinearLayout.LayoutParams(0, dp(52), 1));
        LinearLayout.LayoutParams openParams = new LinearLayout.LayoutParams(0, dp(52), 2);
        openParams.leftMargin = dp(8);
        buttons.addView(open, openParams);
        column.addView(buttons, block(12));

        column.addView(text(R.string.setup_note, 13, Color.rgb(0x66, 0x66, 0x66), false), block(28));

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.setFillViewport(true);
        scroll.setClickable(true); // 下の画面へタップを通さない
        scroll.addView(column);
        return scroll;
    }

    private View buildErrorView() {
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(Color.WHITE);
        column.setPadding(dp(24), dp(40), dp(24), dp(24));
        column.setClickable(true);

        column.addView(text(R.string.error_title, 20, Color.rgb(0x22, 0x22, 0x22), true), block(0));
        column.addView(text(R.string.error_body, 15, Color.rgb(0x44, 0x44, 0x44), false), block(12));

        Button retry = new Button(this);
        retry.setText(R.string.error_retry);
        paintPrimary(retry);
        retry.setOnClickListener(v -> reload());
        LinearLayout.LayoutParams retryParams = block(24);
        retryParams.height = dp(52);
        column.addView(retry, retryParams);

        Button change = new Button(this);
        change.setText(R.string.menu_change_url);
        change.setOnClickListener(v -> showSetup(true));
        LinearLayout.LayoutParams changeParams = block(8);
        changeParams.height = dp(52);
        column.addView(change, changeParams);
        return column;
    }

    // ---- 画面まわりの小道具 ----

    /**
     * ステータスバー・ナビゲーションバー・切り欠き・キーボードのぶんだけ内側に寄せる。
     * キーボードが出たらページの高さが縮むので、easysmarky の入力欄がキーボードに隠れない。
     */
    private void applyInsets(View root) {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), root);
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
                    | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }

    /** 主ボタンの色。背景を複製してから塗る(複製しないと、ほかのボタンまで同じ色になる) */
    private static void paintPrimary(Button button) {
        button.setTextColor(Color.WHITE);
        button.getBackground().mutate().setTint(ACCENT);
    }

    private TextView text(int resId, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(resId);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.35f);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private LinearLayout.LayoutParams block(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(topMarginDp);
        return params;
    }

    private static FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
