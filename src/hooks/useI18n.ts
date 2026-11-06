import { useEffect, useMemo } from "react";
import { useIntl } from "react-intl";
import { get } from "lodash";

// 国际化后缀映射
const i18nSuffix = {
  "zh-CN": "Cn",
  "en-US": "En",
};

// 国际化
const useI18n = () => {
  try {
    const intl = useIntl();
    // 获取国际化函数
    const text = useMemo(() => {
      return (id?: string, values?: Record<string, string | number>) => {
        // 如果没有定义id,给出默认显示字符和相关提示
        if (!id) {
          id = "common.i18n.empty";
        }
        return intl.formatMessage({ id }, values);
      };
    }, [intl]);

    // 获取对象国际化字段
    const textField = useMemo(() => {
      return (record: object | undefined, fieldName: string) => {
        // @ts-ignore
        const fieldValue = get(record, fieldName + i18nSuffix[intl.locale]);
        return fieldValue ? String(fieldValue) : "";
      };
    }, [intl]);

    // 兼容性处理，将'-'替换为'_'
    const i18nObj = useMemo(() => ({
      text,
      textField,
      locale: intl.locale.replace("-", "_"),
      value: intl.locale.toLowerCase().indexOf("en") >= 0 ? "en" : "cn",
    }), [text, textField, intl.locale]);

    // 在 useEffect 中设置全局 window.i18n，避免在渲染过程中触发监听
    useEffect(() => {
      window.i18n = i18nObj;
    }, [i18nObj]);

    return i18nObj;
  } catch (e) {
    console.log("i18n error");
    if (window.i18n) {
      return window.i18n;
    }
    return {
      text: () => "i18n error",
      textField: () => "i18n error",
      locale: "",
      value: "",
    };
  }
};

export default useI18n;
