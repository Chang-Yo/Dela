/** 资源地址：Agent 与界面指代一份资料的方式；type 由登记它的模块解释，其余字段也由它校验。 */
export interface ResourceAddress {
  type: string;
  [field: string]: unknown;
}
