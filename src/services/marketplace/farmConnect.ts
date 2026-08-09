export const FARM_CONNECT_URL = "https://farmconnect-git-68285313197.asia-south1.run.app";

export function isMarketplaceIntent(text: string): boolean {
  const value = text.toLocaleLowerCase();
  return /\b(sell|selling|buyer|buyers|market|marketplace|mandi|price|prices|harvest sale)\b|விற்பனை|சந்தை/.test(value);
}

export function marketplaceHandoff(text: string, question: string): string {
  return isMarketplaceIntent(question)
    ? `${text}\n\nSell your produce through FarmConnect: ${FARM_CONNECT_URL}`
    : text;
}
