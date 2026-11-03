"use client";

import { useSyncExternalStore } from "react";

import { getSettings, subscribeSettings, updateSettings } from "@/lib/profile-settings";
import { cn } from "@/lib/utils";

/**
 * 设置区块（US4，原型图第四卡 .set-row 三行，FR-010/011/015）：
 * 默认口音分段控件（美音/英音）、循环跟读默认开启开关、TTS 语音输出开关；
 * 读写 getSettings()/updateSettings()，useSyncExternalStore(subscribeSettings)
 * 保持选中态同步，改动即时生效（SC-005）。
 */

export function SettingsSection() {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings);

  return (
    <section className="rounded-2xl bg-background p-5 shadow-sm" data-slot="profile-settings">
      <h2 className="text-sm font-semibold">设置</h2>
      <div className="mt-1 divide-y divide-black/5">
        <div className="flex items-center justify-between py-3.5">
          <span className="text-sm">默认口音</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-black/10">
            {(["american", "british"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={settings.accent === value}
                onClick={() => updateSettings({ accent: value })}
                className={cn(
                  "px-5 py-1.5 text-[13px] transition-colors",
                  settings.accent === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "american" ? "美音" : "英音"}
              </button>
            ))}
          </div>
        </div>
        <SwitchRow
          label="循环跟读默认开启"
          value={settings.loopDefault}
          onChange={(value) => updateSettings({ loopDefault: value })}
        />
        <SwitchRow
          label="TTS 语音输出"
          value={settings.ttsEnabled}
          onChange={(value) => updateSettings({ ttsEnabled: value })}
        />
      </div>
    </section>
  );
}

function SwitchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors",
          value ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left]",
            value ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}
