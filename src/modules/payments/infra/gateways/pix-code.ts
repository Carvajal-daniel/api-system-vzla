
import QRCode from "qrcode";

function field(id: string, value: string) {
  return id + Buffer.byteLength(value).toString().padStart(2, "0") + value;
}

function crc16(payload: string) {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
  }
  return crc.toString(16).padStart(4, "0").toUpperCase();
}

export async function encodePixCode(key: string, name: string, amountCents: number, txid: string) {
  const merchant = name.normalize("NFD").replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 25) || "BARBEARIA";
  const payload = field("00", "01") +
    field("26", field("00", "br.gov.bcb.pix") + field("01", key)) +
    field("52", "0000") + field("53", "986") +
    field("54", (amountCents / 100).toFixed(2)) +
    field("58", "BR") + field("59", merchant.toUpperCase()) + field("60", "BRASIL") +
    field("62", field("05", txid.replace(/-/g, "").slice(0, 25))) + "6304";
  const pixCopyPaste = payload + crc16(payload);
  const pixQrCodeBase64 = (await QRCode.toBuffer(pixCopyPaste, { type: "png", width: 320 })).toString("base64");
  return { pixCopyPaste, pixQrCodeBase64 };
}
