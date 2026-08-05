import * as mammoth from 'mammoth';

export async function docxToHtml(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}
