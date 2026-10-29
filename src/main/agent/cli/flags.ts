import { z } from 'zod';

export type FlagKind = 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'array' | 'json';

export type FlagSpec = {
  /** 命令行写法，例如 --include-archived。 */
  name: string;
  /** 对应 input 里的键名，例如 includeArchived。 */
  key: string;
  kind: FlagKind;
  required: boolean;
  nullable: boolean;
  enumValues: string[];
  constraints: string;
  format: string;
  description: string;
};

export type ParseResult =
  { ok: true; input: Record<string, unknown> } | { ok: false; error: string };

type JsonSchema = Record<string, unknown>;

const kebab = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();

/** zod 的 int() 会带上 MAX_SAFE_INTEGER 边界，这类没有实际意义的上下界不写进说明。 */
const MEANINGFUL = 1e15;
const range = (min: unknown, max: unknown, unit: string) => {
  const low = typeof min === 'number' && Math.abs(min) < MEANINGFUL ? min : undefined;
  const high = typeof max === 'number' && Math.abs(max) < MEANINGFUL ? max : undefined;
  if (low === undefined && high === undefined) return '';
  if (high === undefined) return `${unit} ≥${low}`;
  if (low === undefined) return `${unit} ≤${high}`;
  return `${unit} ${low}–${high}`;
};

const constraintsOf = (prop: JsonSchema) =>
  [
    range(prop.minLength, prop.maxLength, '长度'),
    range(prop.minimum, prop.maximum, '取值'),
    range(prop.minItems, prop.maxItems, '数量'),
    prop.format === 'uuid' ? 'uuid' : '',
  ]
    .filter(Boolean)
    .join('，');

/** anyOf 里除 null 之外只剩一支时，把这一支当作真实类型，并记下可空。 */
function unwrap(prop: JsonSchema): { body: JsonSchema; nullable: boolean } {
  const branches = prop.anyOf as JsonSchema[] | undefined;
  if (!branches) return { body: prop, nullable: false };
  const rest = branches.filter((branch) => branch.type !== 'null');
  if (rest.length !== 1) return { body: prop, nullable: false };
  return { body: rest[0]!, nullable: rest.length !== branches.length };
}

const kindOf = (prop: JsonSchema): FlagKind => {
  if (Array.isArray(prop.enum)) return 'enum';
  if (prop.type === 'array') return 'array';
  if (prop.type === 'boolean') return 'boolean';
  if (prop.type === 'integer') return 'integer';
  if (prop.type === 'number') return 'number';
  if (prop.type === 'string') return 'string';
  return 'json';
};

/** 把命令的 zod schema 摊平成命令行参数表；顶层的每个字段对应一个 --flag。 */
export function flagsFromSchema(schema: z.ZodType): FlagSpec[] {
  const json = z.toJSONSchema(schema, { io: 'input' }) as JsonSchema;
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = (json.required ?? []) as string[];
  return Object.entries(properties).map(([key, raw]) => {
    const { body, nullable } = unwrap(raw);
    return {
      name: `--${kebab(key)}`,
      key,
      kind: kindOf(body),
      required: required.includes(key),
      nullable,
      enumValues: Array.isArray(body.enum) ? body.enum.map(String) : [],
      constraints: constraintsOf(body),
      format: typeof body.format === 'string' ? body.format : '',
      description: typeof raw.description === 'string' ? raw.description : '',
    };
  });
}

export const flagValue = (flag: FlagSpec) => {
  if (flag.kind === 'boolean') return '';
  if (flag.kind === 'json') return 'JSON';
  if (flag.kind === 'array') return '值（重复给出）';
  if (flag.kind === 'enum') return flag.enumValues.join('|');
  const base =
    flag.format === 'uuid'
      ? 'uuid'
      : flag.format === 'email'
        ? '邮箱'
        : flag.format === 'date-time'
          ? '时间'
          : flag.kind === 'string'
            ? '文本'
            : '数字';
  return flag.nullable ? `${base}|null` : base;
};

/** 终端里中日韩字符占两列，按显示宽度补齐才能对齐。 */
const isWide = (code: number) =>
  (code >= 0x3000 && code <= 0x9fff) || (code >= 0xff01 && code <= 0xff60);
const displayWidth = (text: string) =>
  [...text].reduce((width, char) => width + (isWide(char.codePointAt(0)!) ? 2 : 1), 0);
const pad = (text: string, width: number) =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)));

export function formatHelp(command: string, description: string, flags: FlagSpec[]) {
  const rows = flags.map((flag) => {
    const signature = `${flag.name}${flag.kind === 'boolean' ? '' : ` ${flagValue(flag)}`}`;
    const toggle =
      flag.kind === 'boolean' ? `开关，${flag.name} 置假用 --no-${flag.name.slice(2)}` : '';
    const note = [flag.required ? '必填' : '可选', flag.constraints, toggle, flag.description]
      .filter(Boolean)
      .join('；');
    return { signature, note };
  });
  const width = Math.max(...rows.map((row) => displayWidth(row.signature))) + 2;
  return [
    description,
    '',
    `用法：dela ${command} [参数]`,
    '',
    ...rows.map((row) => `  ${pad(row.signature, width)}${row.note}`),
  ].join('\n');
}

function toValue(flag: FlagSpec, raw: string): { value: unknown } | { error: string } {
  if (raw === 'null' && flag.nullable) return { value: null };
  if (flag.kind === 'enum') {
    return flag.enumValues.includes(raw)
      ? { value: raw }
      : { error: `${flag.name} 只能取 ${flag.enumValues.join(' / ')}` };
  }
  if (flag.kind === 'integer' || flag.kind === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) return { error: `${flag.name} 需要数字，收到 ${raw}` };
    if (flag.kind === 'integer' && !Number.isInteger(value))
      return { error: `${flag.name} 需要整数，收到 ${raw}` };
    return { value };
  }
  if (flag.kind === 'json') {
    try {
      return { value: JSON.parse(raw) };
    } catch {
      return { error: `${flag.name} 需要合法 JSON，收到 ${raw}` };
    }
  }
  return { value: raw };
}

/** 解析 `--flag value` / `--flag=value` / `--flag` / `--no-flag`，返回可以直接交给命令的 input。 */
export function parseArgv(argv: string[], flags: FlagSpec[]): ParseResult {
  const byName = new Map<string, FlagSpec>();
  for (const flag of flags) {
    byName.set(flag.name, flag);
    if (flag.kind === 'boolean') byName.set(`--no-${flag.name.slice(2)}`, flag);
  }
  const input: Record<string, unknown> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--') || token === '--') return { ok: false, error: `多余参数 ${token}` };
    const [name, inline] = token.includes('=')
      ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
      : [token, undefined];
    const flag = byName.get(name);
    if (!flag) {
      const names = flags.map((item) => item.name).join(' ');
      return { ok: false, error: `未知参数 ${name}，可用：${names}` };
    }
    const negated = name.startsWith('--no-');
    if (flag.kind === 'boolean') {
      if (inline !== undefined) return { ok: false, error: `${name} 是开关，不要带值` };
      input[flag.key] = !negated;
      continue;
    }
    const raw = inline ?? argv[++index];
    if (raw === undefined) return { ok: false, error: `${name} 缺少取值` };
    const converted = toValue(flag, raw);
    if ('error' in converted) return { ok: false, error: converted.error };
    input[flag.key] =
      flag.kind === 'array'
        ? [...((input[flag.key] as unknown[] | undefined) ?? []), converted.value]
        : converted.value;
  }
  const missing = flags
    .filter((flag) => flag.required && input[flag.key] === undefined)
    .map((flag) => flag.name);
  if (missing.length > 0) return { ok: false, error: `缺少必填参数 ${missing.join(' ')}` };
  return { ok: true, input };
}
