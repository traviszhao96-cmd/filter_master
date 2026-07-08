package com.scene.lut.mlkitlabeler;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class LabelReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        PendingResult pendingResult = goAsync();
        String inputPath = intent.getStringExtra("input");
        String outputPath = intent.getStringExtra("output");
        LabelRunner.run(context.getApplicationContext(), inputPath, outputPath, pendingResult::finish);
    }
}
