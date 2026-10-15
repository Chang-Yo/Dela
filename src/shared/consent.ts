/** 生成条款接受记录的接口：只写不读，读取靠直接看 dela.db。 */
export interface ConsentApi {
  /** 记一条接受记录。document 是哪一份条款，revision 是正文顶部的「最后更新」日期。 */
  record(document: ConsentDocument, revision: string): Promise<void>;
}

export type ConsentDocument = 'terms' | 'privacy';
