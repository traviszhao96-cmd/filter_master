package com.scene.lut.mlkitlabeler;

import android.app.Activity;
import android.os.Bundle;

public class LabelActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String inputPath = getIntent().getStringExtra("input");
        String outputPath = getIntent().getStringExtra("output");
        LabelRunner.run(this, inputPath, outputPath, this::finish);
    }
}
