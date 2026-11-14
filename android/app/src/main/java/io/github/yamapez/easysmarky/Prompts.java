package io.github.yamapez.easysmarky;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.text.InputType;
import android.widget.EditText;
import android.widget.FrameLayout;

import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSession.PromptDelegate;

import java.util.ArrayList;
import java.util.List;

/**
 * ページが出すダイアログ(alert / confirm / prompt / select / ファイル選択 / 離脱の確認)を
 * Android のダイアログで出す。GeckoView は自前では何も出さないので、これが無いと
 * confirm() は黙って「いいえ」になり、easysmarky の「破棄する」「上書きして保存」が効かなくなる。
 */
final class Prompts implements PromptDelegate {
    static final int REQUEST_FILE = 1001;

    private final Activity activity;
    private FilePrompt pendingFile;
    private GeckoResult<PromptResponse> pendingFileResult;

    Prompts(Activity activity) {
        this.activity = activity;
    }

    /** 1つのダイアログに対して、答えを1回だけ返す */
    private static final class Answer {
        final GeckoResult<PromptResponse> result = new GeckoResult<>();
        private boolean done;

        void give(PromptResponse response) {
            if (done) return;
            done = true;
            result.complete(response);
        }
    }

    /** ダイアログを出す。答えないまま閉じられたら(戻るキー・枠外タップ・ページ側の取り下げ)dismiss を返す */
    private GeckoResult<PromptResponse> show(BasePrompt prompt, AlertDialog.Builder builder, Answer answer) {
        if (activity.isFinishing() || activity.isDestroyed()) {
            return GeckoResult.fromValue(prompt.dismiss());
        }
        AlertDialog dialog = builder.create();
        dialog.setOnDismissListener(d -> {
            if (!prompt.isComplete()) answer.give(prompt.dismiss());
        });
        prompt.setDelegate(new PromptInstanceDelegate() {
            @Override
            public void onPromptDismiss(BasePrompt p) {
                dialog.dismiss();
            }
        });
        dialog.show();
        return answer.result;
    }

    @Override
    public GeckoResult<PromptResponse> onAlertPrompt(GeckoSession session, AlertPrompt prompt) {
        Answer answer = new Answer();
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setMessage(prompt.message)
                .setPositiveButton(android.R.string.ok, (d, w) -> answer.give(prompt.dismiss()));
        return show(prompt, builder, answer);
    }

    @Override
    public GeckoResult<PromptResponse> onButtonPrompt(GeckoSession session, ButtonPrompt prompt) {
        Answer answer = new Answer();
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setMessage(prompt.message)
                .setPositiveButton(android.R.string.ok,
                        (d, w) -> answer.give(prompt.confirm(ButtonPrompt.Type.POSITIVE)))
                .setNegativeButton(R.string.cancel,
                        (d, w) -> answer.give(prompt.confirm(ButtonPrompt.Type.NEGATIVE)));
        return show(prompt, builder, answer);
    }

    @Override
    public GeckoResult<PromptResponse> onTextPrompt(GeckoSession session, TextPrompt prompt) {
        Answer answer = new Answer();
        EditText input = new EditText(activity);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setText(prompt.defaultValue);
        FrameLayout frame = new FrameLayout(activity);
        int pad = Math.round(20 * activity.getResources().getDisplayMetrics().density);
        frame.setPadding(pad, 0, pad, 0);
        frame.addView(input);
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setMessage(prompt.message)
                .setView(frame)
                .setPositiveButton(android.R.string.ok,
                        (d, w) -> answer.give(prompt.confirm(input.getText().toString())))
                .setNegativeButton(R.string.cancel, (d, w) -> answer.give(prompt.dismiss()));
        return show(prompt, builder, answer);
    }

    @Override
    public GeckoResult<PromptResponse> onBeforeUnloadPrompt(GeckoSession session, BeforeUnloadPrompt prompt) {
        Answer answer = new Answer();
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setMessage(R.string.leave_message)
                .setPositiveButton(R.string.leave_yes, (d, w) -> answer.give(prompt.confirm(AllowOrDeny.ALLOW)))
                .setNegativeButton(R.string.leave_no, (d, w) -> answer.give(prompt.confirm(AllowOrDeny.DENY)));
        return show(prompt, builder, answer);
    }

    @Override
    public GeckoResult<PromptResponse> onRepostConfirmPrompt(GeckoSession session, RepostConfirmPrompt prompt) {
        Answer answer = new Answer();
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setMessage(R.string.repost_message)
                .setPositiveButton(R.string.repost_yes, (d, w) -> answer.give(prompt.confirm(AllowOrDeny.ALLOW)))
                .setNegativeButton(R.string.cancel, (d, w) -> answer.give(prompt.confirm(AllowOrDeny.DENY)));
        return show(prompt, builder, answer);
    }

    /** 操作なしに開こうとしたウィンドウ(ポップアップ)は開かない */
    @Override
    public GeckoResult<PromptResponse> onPopupPrompt(GeckoSession session, PopupPrompt prompt) {
        return GeckoResult.fromValue(prompt.confirm(AllowOrDeny.DENY));
    }

    /** select 要素。見出し(optgroup)は項目名の前に付け、選べない項目と区切り線は出さない */
    @Override
    public GeckoResult<PromptResponse> onChoicePrompt(GeckoSession session, ChoicePrompt prompt) {
        List<ChoicePrompt.Choice> items = new ArrayList<>();
        List<String> labels = new ArrayList<>();
        flatten(prompt.choices, "", items, labels);
        String[] labelArray = labels.toArray(new String[0]);

        Answer answer = new Answer();
        AlertDialog.Builder builder = new AlertDialog.Builder(activity);
        if (prompt.message != null && !prompt.message.isEmpty()) builder.setTitle(prompt.message);

        if (prompt.type == ChoicePrompt.Type.MULTIPLE) {
            boolean[] checked = new boolean[items.size()];
            for (int i = 0; i < checked.length; i++) checked[i] = items.get(i).selected;
            builder.setMultiChoiceItems(labelArray, checked, (d, which, isChecked) -> checked[which] = isChecked)
                    .setPositiveButton(android.R.string.ok, (d, w) -> {
                        List<ChoicePrompt.Choice> picked = new ArrayList<>();
                        for (int i = 0; i < checked.length; i++) if (checked[i]) picked.add(items.get(i));
                        answer.give(prompt.confirm(picked.toArray(new ChoicePrompt.Choice[0])));
                    })
                    .setNegativeButton(R.string.cancel, (d, w) -> answer.give(prompt.dismiss()));
        } else {
            int current = -1;
            for (int i = 0; i < items.size(); i++) if (items.get(i).selected) current = i;
            builder.setSingleChoiceItems(labelArray, current, (d, which) -> {
                answer.give(prompt.confirm(items.get(which)));
                d.dismiss();
            });
        }
        return show(prompt, builder, answer);
    }

    private static void flatten(ChoicePrompt.Choice[] choices, String group,
                                List<ChoicePrompt.Choice> items, List<String> labels) {
        if (choices == null) return;
        for (ChoicePrompt.Choice choice : choices) {
            if (choice.separator) continue;
            if (choice.items != null) {
                flatten(choice.items, choice.label == null ? group : choice.label + " / ", items, labels);
            } else if (!choice.disabled) {
                items.add(choice);
                labels.add(group + (choice.label == null ? "" : choice.label));
            }
        }
    }

    /** ファイル選択。端末のファイル選択画面を開き、結果は MainActivity の onActivityResult から受け取る */
    @Override
    public GeckoResult<PromptResponse> onFilePrompt(GeckoSession session, FilePrompt prompt) {
        if (pendingFile != null) return GeckoResult.fromValue(prompt.dismiss());

        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        List<String> types = new ArrayList<>();
        if (prompt.mimeTypes != null) {
            // ".pdf" のような拡張子の指定は Android のファイル選択に渡せないので、MIME の形だけ使う
            for (String type : prompt.mimeTypes) if (type != null && type.contains("/")) types.add(type);
        }
        intent.setType(types.size() == 1 ? types.get(0) : "*/*");
        if (types.size() > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        if (prompt.type == FilePrompt.Type.MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

        GeckoResult<PromptResponse> result = new GeckoResult<>();
        try {
            activity.startActivityForResult(intent, REQUEST_FILE);
        } catch (RuntimeException e) {
            return GeckoResult.fromValue(prompt.dismiss());
        }
        pendingFile = prompt;
        pendingFileResult = result;
        return result;
    }

    void onFileResult(int resultCode, Intent data) {
        FilePrompt prompt = pendingFile;
        GeckoResult<PromptResponse> result = pendingFileResult;
        pendingFile = null;
        pendingFileResult = null;
        if (prompt == null || result == null) return;

        if (resultCode != Activity.RESULT_OK || data == null) {
            result.complete(prompt.dismiss());
            return;
        }
        ClipData clip = data.getClipData();
        if (prompt.type == FilePrompt.Type.MULTIPLE && clip != null) {
            Uri[] uris = new Uri[clip.getItemCount()];
            for (int i = 0; i < uris.length; i++) uris[i] = clip.getItemAt(i).getUri();
            result.complete(prompt.confirm(activity, uris));
        } else if (data.getData() != null) {
            result.complete(prompt.confirm(activity, data.getData()));
        } else {
            result.complete(prompt.dismiss());
        }
    }
}
