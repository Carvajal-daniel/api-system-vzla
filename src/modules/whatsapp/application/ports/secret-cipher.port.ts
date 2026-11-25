// Porta de criptografia simétrica para proteger tokens de provedores externos em repouso.
export interface SecretCipherPort {
  encrypt(plainText: string): string;
  decrypt(cipherText: string): string;
}
