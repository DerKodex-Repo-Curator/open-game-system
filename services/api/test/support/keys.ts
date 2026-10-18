/** Test-only keys, made fresh per run: an APNs-style .p8 (P-256 PKCS#8 PEM) and an FCM service account. */

const pem = (label: string, der: ArrayBuffer) => {
  const b64 = Buffer.from(der).toString("base64");
  return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)?.join("\n") ?? b64}\n-----END ${label}-----\n`;
};

async function pkcs8(key: CryptoKey): Promise<ArrayBuffer> {
  const der = await crypto.subtle.exportKey("pkcs8", key);
  if (!(der instanceof ArrayBuffer)) throw new Error("expected PKCS#8 bytes");
  return der;
}

export async function p8Pem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  if (!("privateKey" in pair)) throw new Error("expected a key pair");
  return pem("PRIVATE KEY", await pkcs8(pair.privateKey));
}

export async function fcmServiceAccount() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in pair)) throw new Error("expected a key pair");
  return {
    type: "service_account",
    project_id: "rocket-crew-test",
    private_key_id: "kid-1",
    private_key: pem("PRIVATE KEY", await pkcs8(pair.privateKey)),
    client_email: "push@rocket-crew-test.iam.gserviceaccount.com",
    token_uri: "https://oauth2.googleapis.com/token",
  };
}
