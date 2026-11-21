package io.github.yraguo.firstmove;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.widget.*;
import java.net.URI;

public class MainActivity extends Activity {
    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        layout.setPadding(dp(28), dp(40), dp(28), dp(40));
        layout.setBackgroundColor(Color.rgb(252, 249, 247));
        setContentView(layout);
        ImageView logo = new ImageView(this);
        logo.setImageResource(getApplicationInfo().icon);
        layout.addView(logo, dp(60), dp(60));
        TextView title = new TextView(this);
        title.setText("连接先行");
        title.setTextSize(28);
        title.setPadding(0, dp(14), 0, dp(18));
        layout.addView(title);
        TextView label = new TextView(this);
        label.setText("工作台地址 · Server URL");
        layout.addView(label);
        EditText server = new EditText(this);
        server.setSingleLine();
        server.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        server.setHint("https://work.example.com");
        server.setText(getPreferences(MODE_PRIVATE).getString("server", ""));
        layout.addView(server);
        Button connect = new Button(this);
        connect.setText("连接 · Connect");
        connect.setTextColor(Color.WHITE);
        connect.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff4b0f1f));
        layout.addView(connect);
        connect.setOnClickListener(view -> {
            try {
                URI uri = URI.create(server.getText().toString().trim());
                if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
                        uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getFragment() != null ||
                        !(uri.getRawPath().isEmpty() || uri.getRawPath().equals("/"))) {
                    throw new IllegalArgumentException();
                }
                String origin = "https://" + uri.getRawAuthority();
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(origin + "/"));
                Bundle options = new Bundle();
                options.putBinder("android.support.customtabs.extra.SESSION", null);
                intent.putExtras(options);
                intent.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", 0xff4b0f1f);
                startActivity(intent);
                getPreferences(MODE_PRIVATE).edit().putString("server", origin).apply();
            } catch (IllegalArgumentException error) {
                server.setError("请输入 HTTPS 工作台首页地址");
            } catch (ActivityNotFoundException error) {
                Toast.makeText(this, "请先安装可打开 HTTPS 的浏览器", Toast.LENGTH_LONG).show();
            }
        });
    }
}
