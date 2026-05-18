/**
 * Thin wrapper around the WhatsApp Business Cloud API.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */

const GRAPH_VERSION = "v18.0";

export type WATemplateParam = string;

/**
 * Send a templated WhatsApp message via Meta Graph API.
 *
 * @param toPhone     Recipient phone in E.164 format (e.g. "15085551234"). Leading "+" is stripped.
 * @param templateName Name of the approved template in Meta Business Manager.
 * @param params      Ordered list of body parameters that fill the {{1}}, {{2}}, ... placeholders.
 * @param languageCode Language code of the template. Defaults to "en" — Meta lists
 *                    templates created under "English" with code `en`, NOT `en_US`.
 *                    Override if you actually created the template under English (US).
 */
export async function sendWhatsAppTemplate(
  toPhone: string,
  templateName: string,
  params: WATemplateParam[] = [],
  languageCode: string = "en"
): Promise<{ ok: boolean; messageId?: string; error?: string; raw?: unknown }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return {
      ok: false,
      error:
        "Missing WhatsApp credentials. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.",
    };
  }

  const normalized = normalizePhone(toPhone);
  if (!normalized) {
    return { ok: false, error: `Invalid phone number: ${toPhone}` };
  }

  const body = {
    messaging_product: "whatsapp",
    to: normalized,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components:
        params.length > 0
          ? [
              {
                type: "body",
                parameters: params.map((p) => ({ type: "text", text: p })),
              },
            ]
          : [],
    },
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      const errorMsg =
        data?.error?.message || `HTTP ${res.status} from WhatsApp API`;
      console.error("[whatsapp] template send failed:", errorMsg, data);
      return { ok: false, error: errorMsg, raw: data };
    }

    const messageId = data?.messages?.[0]?.id;
    console.log(
      `[whatsapp] sent template "${templateName}" to ${normalized} → ${messageId}`
    );
    return { ok: true, messageId, raw: data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp] fetch failed:", message);
    return { ok: false, error: message };
  }
}

/**
 * Send a free-form text WhatsApp message.
 *
 * Only works within the 24-hour "customer service window" — i.e. after the
 * recipient has sent us a message. Outside that window, you must use a
 * pre-approved template (sendWhatsAppTemplate).
 *
 * Used for AI auto-replies, which always happen after an inbound message.
 */
export async function sendWhatsAppText(
  toPhone: string,
  text: string
): Promise<{ ok: boolean; messageId?: string; error?: string; raw?: unknown }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return { ok: false, error: "Missing WhatsApp credentials." };
  }

  const normalized = normalizePhone(toPhone);
  if (!normalized) {
    return { ok: false, error: `Invalid phone number: ${toPhone}` };
  }

  const body = {
    messaging_product: "whatsapp",
    to: normalized,
    type: "text",
    text: { body: text, preview_url: false },
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();
    if (!res.ok) {
      const errorMsg =
        data?.error?.message || `HTTP ${res.status} from WhatsApp API`;
      console.error("[whatsapp] text send failed:", errorMsg, data);
      return { ok: false, error: errorMsg, raw: data };
    }

    const messageId = data?.messages?.[0]?.id;
    console.log(`[whatsapp] sent text to ${normalized} → ${messageId}`);
    return { ok: true, messageId, raw: data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp] text fetch failed:", message);
    return { ok: false, error: message };
  }
}

/**
 * Strip everything that isn't a digit, then ensure the country code is present.
 * WhatsApp expects E.164 *without* the leading "+".
 *
 * Heuristic: if the result is exactly 10 digits, assume US and prepend "1".
 * Numbers 11+ digits long are assumed to already include their country code.
 */
export function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D+/g, "");
  if (digits.length < 8) return null;
  // US default — 10-digit numbers get a "1" prefix.
  if (digits.length === 10) digits = "1" + digits;
  return digits;
}

/**
 * Format a phone number for wa.me / tel: links.
 */
export function waMeLink(phone: string): string {
  const n = normalizePhone(phone);
  return n ? `https://wa.me/${n}` : "#";
}
