import React, { useEffect, useMemo, useState } from "react";
import { SdkContext } from "contexts";
import { FatNotesPluginSDK } from "fat-notes-sdk";
import { IntlProvider } from "react-intl";
import cn from "../../../locales/zh_CN";
import en from "../../../locales/en_US";

interface InitSdkProps {
  sdk: FatNotesPluginSDK | undefined;
  children: React.ReactNode;
}

const DEFAULT_LOCALE = "zh_CN";

// 将宿主 locale 归一化为当前插件支持的语言包 key
const normalizeLocale = (locale?: string) => {
  if (!locale) {
    return DEFAULT_LOCALE;
  }
  const normalizedLocale = locale.replace("-", "_");
  if (normalizedLocale === "zh_CN" || normalizedLocale.startsWith("zh")) {
    return "zh_CN";
  }
  if (normalizedLocale === "en_US" || normalizedLocale.startsWith("en")) {
    return "en_US";
  }
  return DEFAULT_LOCALE;
};

// 语言映射
const LANG_MAP: Record<string, Record<string, string>> = {
  zh_CN: cn,
  en_US: en,
};

const InitSdk = (props: InitSdkProps) => {
  const { sdk, children } = props;
  const [locale, setLocale] = useState(() =>
    normalizeLocale(sdk?.ui.i18n.locale),
  );
  // 宿主的消息目录。宿主的远程组件（如 DataQueryCommon）内部使用
  // react-intl 的 useIntl() 查找 key，但它们渲染在插件的 IntlProvider
  // 之下，因此需要把宿主的消息合并进来，否则组件会直接显示 i18n key。
  const [hostMessages, setHostMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!sdk) {
      return;
    }
    const applyLocale = (nextLocale: string) => {
      const normalized = normalizeLocale(nextLocale);
      setLocale(normalized);
      // locale 切换后宿主消息目录也会变化，需要重新拉取
      try {
        setHostMessages(sdk.ui.i18n.getMessages() || {});
      } catch {
        setHostMessages({});
      }
    };
    applyLocale(sdk.ui.i18n.locale);
    const disposable = sdk.ui.i18n.onChange(applyLocale);
    return () => disposable.dispose();
  }, [sdk]);

  // 合并策略：宿主消息作为基础（提供 widget.query.* 等宿主组件需要的 key），
  // 插件消息覆盖同名 key（保证插件自身 UI 使用自己的翻译）。
  const messages = useMemo(() => {
    const pluginMessages = LANG_MAP[locale] || LANG_MAP[DEFAULT_LOCALE];
    return { ...hostMessages, ...pluginMessages };
  }, [hostMessages, locale]);

  return sdk ? (
    <IntlProvider locale={locale.replace("_", "-")} messages={messages}>
      <SdkContext.Provider value={{ sdk }}>{children}</SdkContext.Provider>
    </IntlProvider>
  ) : null;
};

export default InitSdk;
