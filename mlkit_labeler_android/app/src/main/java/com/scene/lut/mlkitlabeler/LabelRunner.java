package com.scene.lut.mlkitlabeler;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.label.ImageLabel;
import com.google.mlkit.vision.label.ImageLabeler;
import com.google.mlkit.vision.label.ImageLabeling;
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.List;

public final class LabelRunner {
    private static final String TAG = "SceneLutLabeler";

    private LabelRunner() {}

    public interface Callback {
        void onComplete();
    }

    public static void run(Context context, String inputPath, String outputPath, Callback callback) {
        Log.i(TAG, "Label request input=" + inputPath + " output=" + outputPath);
        if (inputPath == null || outputPath == null) {
            finishWithError(outputPath, "Missing input or output extra", callback);
            return;
        }

        try {
            InputImage image = InputImage.fromFilePath(context, Uri.fromFile(new File(inputPath)));
            ImageLabeler labeler = ImageLabeling.getClient(ImageLabelerOptions.DEFAULT_OPTIONS);
            labeler.process(image)
                .addOnSuccessListener(labels -> {
                    Log.i(TAG, "Labeling succeeded with " + labels.size() + " labels");
                    writeLabels(outputPath, inputPath, labels);
                    callback.onComplete();
                })
                .addOnFailureListener(error -> {
                    Log.e(TAG, "Labeling failed", error);
                    finishWithError(outputPath, error.getMessage(), callback);
                });
        } catch (Exception error) {
            Log.e(TAG, "Unable to start labeling", error);
            finishWithError(outputPath, error.getMessage(), callback);
        }
    }

    private static void writeLabels(String outputPath, String inputPath, List<ImageLabel> labels) {
        StringBuilder json = new StringBuilder();
        json.append("{\"source\":\"mlkit-android-helper\",\"input\":")
            .append(quote(inputPath))
            .append(",\"labels\":[");
        for (int i = 0; i < labels.size(); i++) {
            ImageLabel label = labels.get(i);
            if (i > 0) json.append(',');
            json.append("{\"index\":")
                .append(label.getIndex())
                .append(",\"label\":")
                .append(quote(label.getText()))
                .append(",\"confidence\":")
                .append(label.getConfidence())
                .append('}');
        }
        json.append("]}");
        writeFile(outputPath, json.toString());
    }

    private static void finishWithError(String outputPath, String message, Callback callback) {
        if (outputPath != null) {
            writeFile(outputPath, "{\"error\":" + quote(message == null ? "unknown" : message) + "}");
        }
        callback.onComplete();
    }

    private static void writeFile(String outputPath, String content) {
        try {
            File output = new File(outputPath);
            File parent = output.getParentFile();
            if (parent != null) parent.mkdirs();
            try (FileWriter writer = new FileWriter(output, false)) {
                writer.write(content);
            }
            Log.i(TAG, "Wrote output " + outputPath);
        } catch (IOException error) {
            Log.e(TAG, "Unable to write output", error);
        }
    }

    private static String quote(String text) {
        StringBuilder escaped = new StringBuilder("\"");
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            switch (ch) {
                case '\\':
                    escaped.append("\\\\");
                    break;
                case '"':
                    escaped.append("\\\"");
                    break;
                case '\n':
                    escaped.append("\\n");
                    break;
                case '\r':
                    escaped.append("\\r");
                    break;
                case '\t':
                    escaped.append("\\t");
                    break;
                default:
                    escaped.append(ch);
            }
        }
        escaped.append('"');
        return escaped.toString();
    }
}
