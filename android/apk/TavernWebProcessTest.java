package com.deepseekharness.app.util;

import org.junit.Test;
import static org.junit.Assert.*;

public class TavernWebProcessTest {
    private static final String NODE = "node /usr/local/bin/dsh --profile tavern --no-open --host 127.0.0.1 --port 3080";

    @Test public void tavernUsesNativeWebLifecycleWithoutBroadeningKillScope() {
        assertTrue(WebProcSel.maySignalWeb(NODE));
        assertTrue(WebProcSel.looksLikeWeb(NODE));
        assertFalse(WebProcSel.maySignalWeb("bash -c " + NODE));
        assertFalse(WebProcSel.maySignalWeb("libproot.so " + NODE));
        assertFalse(WebProcSel.maySignalWeb(NODE.replace("--profile tavern", "--profile personal")));
        assertFalse(WebProcSel.maySignalWeb(NODE.replace("--profile tavern", "--profile tavern-other")));
    }

    @Test public void tavernLauncherShellIsRecognizedButWebProfileIsNot() {
        // 真实 /proc/<pid>/cmdline 是 NUL 分隔的：argv[2] 是整段 shell 脚本。
        String tavern = WebLaunchCommand.build("default", false, "zh", "tavern", 3080, 7);
        assertTrue(tavern.contains("DSH_TAVERN_RUNTIME_HOST=android"));
        assertTrue(tavern.contains("DSH_TAVERN_ANDROID_STANDALONE=1"));
        assertTrue(tavern.contains("exec dsh --profile 'tavern'"));
        assertTrue(WebProcSel.looksLikeWeb("bash\0-c\0" + tavern));
        assertTrue(WebProcSel.looksLikeWeb("bash\0-c\0" + WebLaunchCommand.build("default", false, "zh", "web", 3080, 7)));
        assertFalse(WebProcSel.looksLikeWeb("bash\0-c\0" + WebLaunchCommand.build("default", false, "zh", "personal", 3080, 7)));
    }
}
