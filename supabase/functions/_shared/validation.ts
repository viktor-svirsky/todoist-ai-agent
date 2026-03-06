export interface ValidationError {
  field: string;
  message: string;
}

export function validateSettings(
  updates: Record<string, unknown>
): ValidationError[] {
  const errors: ValidationError[] = [];

  if ("max_messages" in updates) {
    const v = updates.max_messages;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) {
      errors.push({ field: "max_messages", message: "Must be an integer between 1 and 100" });
    }
  }

  if ("trigger_word" in updates) {
    const v = updates.trigger_word;
    if (typeof v !== "string" || v.length < 1 || v.length > 50) {
      errors.push({ field: "trigger_word", message: "Must be a string between 1 and 50 characters" });
    }
  }

  if ("custom_ai_base_url" in updates && updates.custom_ai_base_url != null) {
    const v = updates.custom_ai_base_url;
    if (typeof v !== "string") {
      errors.push({ field: "custom_ai_base_url", message: "Must be a string" });
    } else {
      try {
        const url = new URL(v);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          errors.push({ field: "custom_ai_base_url", message: "Must use http or https protocol" });
        }
      } catch {
        errors.push({ field: "custom_ai_base_url", message: "Must be a valid URL" });
      }
    }
  }

  if ("custom_ai_model" in updates && updates.custom_ai_model != null) {
    const v = updates.custom_ai_model;
    if (typeof v !== "string" || v.length > 100) {
      errors.push({ field: "custom_ai_model", message: "Must be a string of at most 100 characters" });
    }
  }

  if ("custom_ai_api_key" in updates && updates.custom_ai_api_key != null) {
    const v = updates.custom_ai_api_key;
    if (typeof v !== "string" || v.length > 500) {
      errors.push({ field: "custom_ai_api_key", message: "Must be a string of at most 500 characters" });
    }
  }

  if ("custom_brave_key" in updates && updates.custom_brave_key != null) {
    const v = updates.custom_brave_key;
    if (typeof v !== "string" || v.length > 500) {
      errors.push({ field: "custom_brave_key", message: "Must be a string of at most 500 characters" });
    }
  }

  if ("custom_prompt" in updates && updates.custom_prompt != null) {
    const v = updates.custom_prompt;
    if (typeof v !== "string" || v.length > 2000) {
      errors.push({ field: "custom_prompt", message: "Must be a string of at most 2000 characters" });
    }
  }

  if ("digest_enabled" in updates) {
    const v = updates.digest_enabled;
    if (typeof v !== "boolean") {
      errors.push({ field: "digest_enabled", message: "Must be a boolean" });
    }
  }

  if ("digest_time" in updates) {
    const v = updates.digest_time;
    if (typeof v !== "string" || !/^\d{2}:\d{2}$/.test(v)) {
      errors.push({ field: "digest_time", message: "Must be in HH:MM format" });
    } else {
      const [h, m] = v.split(":").map(Number);
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        errors.push({ field: "digest_time", message: "Must be a valid time (00:00–23:59)" });
      }
    }
  }

  if ("digest_timezone" in updates) {
    const v = updates.digest_timezone;
    if (typeof v !== "string") {
      errors.push({ field: "digest_timezone", message: "Must be a string" });
    } else {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: v });
      } catch {
        errors.push({ field: "digest_timezone", message: "Must be a valid IANA timezone" });
      }
    }
  }

  if ("digest_project_id" in updates && updates.digest_project_id != null) {
    const v = updates.digest_project_id;
    if (typeof v !== "string") {
      errors.push({ field: "digest_project_id", message: "Must be a string or null" });
    }
  }

  return errors;
}
