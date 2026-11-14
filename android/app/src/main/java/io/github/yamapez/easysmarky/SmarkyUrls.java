package io.github.yamapez.easysmarky;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Smarky のURLの読み取り。学校ごとの接頭辞(school_url_prefix)だけを覚える。 */
final class SmarkyUrls {
    static final String HOST = "digi-repo.smarky.jp";

    /** 貼り付け・共有された文章の中から Smarky のURLを拾う(前後に題名などが付いていてもよい) */
    private static final Pattern IN_TEXT = Pattern.compile("https://digi-repo\\.smarky\\.jp(?:/\\S*)?");
    /** 生徒の画面のURL。Smarky はハッシュでページを分けている: /#/{接頭辞}/student_site/… */
    private static final Pattern STUDENT =
            Pattern.compile("^https://digi-repo\\.smarky\\.jp/[^#]*#/([^/?#]+)/student_site(?:[/?]|$)");

    private SmarkyUrls() {}

    /** 文章の中の最初の Smarky のURL。無ければ null */
    static String findIn(String text) {
        if (text == null) return null;
        Matcher m = IN_TEXT.matcher(text);
        return m.find() ? m.group() : null;
    }

    /** 生徒の画面のURLなら学校の接頭辞。そうでなければ null */
    static String schoolPrefix(String url) {
        if (url == null) return null;
        Matcher m = STUDENT.matcher(url);
        return m.find() ? m.group(1) : null;
    }

    /**
     * 起動時に開くURL。レポートの一覧を指す。
     * 未ログインなら Smarky 自身がログイン画面へ送る(公式 app.js の 401 の扱い)。
     */
    static String startUrl(String prefix) {
        return "https://" + HOST + "/#/" + prefix + "/student_site/sheet_list";
    }
}
