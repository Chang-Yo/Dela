import clsx from 'clsx';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import styles from './HomeView.module.css';

type HomeViewProps = { onOpenProject: () => void };

type ProjectCardProps = {
  code: string;
  monogram: 'amber' | 'green' | 'blue';
  name: string;
  description: string;
  status: string;
  updated: string;
  onClick?: () => void;
};

function ProjectCard({
  code,
  monogram,
  name,
  description,
  status,
  updated,
  onClick,
}: ProjectCardProps) {
  return (
    <button className={styles.projectCard} onClick={onClick} type="button">
      <div className={styles.projectCardTop}>
        <span className={clsx(styles.projectMonogram, styles[monogram])}>{code}</span>
        <span className={styles.moreButton}>•••</span>
      </div>
      <div>
        <h3>{name}</h3>
        <p>{description}</p>
      </div>
      <div className={styles.projectMeta}>
        <span>{status}</span>
        <span>{updated}</span>
      </div>
    </button>
  );
}

export function HomeView({ onOpenProject }: HomeViewProps) {
  return (
    <div className="page">
      <PageHeader
        actions={
          <>
            <button className={styles.searchButton} type="button">
              <span aria-hidden="true">⌕</span>搜索<kbd>Ctrl K</kbd>
            </button>
            <Button className={styles.headerPrimary} variant="primary">
              ＋ 新建项目
            </Button>
          </>
        }
        eyebrow="9 月 10 日 · 星期四"
        title="下午好"
      />
      <div className={styles.previewNote}>
        <span>预览</span>当前内容为界面示例，尚未连接个人数据。
      </div>
      <section aria-label="今日概览" className={styles.focusGrid}>
        <article className={styles.deadlineCard}>
          <div className={styles.cardHeadingRow}>
            <div>
              <p className="eyebrow">最近截止</p>
              <h2>机器学习 Lab 1</h2>
            </div>
            <div className={styles.dateTile}>
              <strong>12</strong>
              <span>SEP</span>
            </div>
          </div>
          <p className={styles.cardCopy}>完成实验报告，并核对提交格式与数据集引用。</p>
          <div className={styles.progressRow}>
            <div aria-label="进度 60%" className={styles.progressTrack}>
              <span style={{ width: '60%' }} />
            </div>
            <span>3 / 5</span>
          </div>
          <Button onClick={onOpenProject} variant="text">
            继续工作 <span aria-hidden="true">→</span>
          </Button>
        </article>
        <article className={styles.attentionCard}>
          <p className="eyebrow">需要留意</p>
          <ul className={styles.attentionList}>
            <li>
              <span className={styles.attentionIcon}>!</span>
              <div>
                <strong>课程要求有更新</strong>
                <p>Lab 1 · 2 小时前</p>
              </div>
            </li>
            <li>
              <span className={clsx(styles.attentionIcon, styles.neutral)}>↻</span>
              <div>
                <strong>邮箱需要重新登录</strong>
                <p>上次同步：昨天 22:14</p>
              </div>
            </li>
          </ul>
          <Button variant="text">
            查看全部 <span aria-hidden="true">→</span>
          </Button>
        </article>
      </section>
      <section className={styles.contentSection}>
        <div className={styles.contentSectionHeading}>
          <div>
            <p className="eyebrow">工作区</p>
            <h2>继续最近的项目</h2>
          </div>
          <Button size="sm" variant="quiet">
            全部项目
          </Button>
        </div>
        <div className={styles.projectCardGrid}>
          <ProjectCard
            code="ML"
            description="实验报告与提交清单"
            monogram="amber"
            name="机器学习 Lab 1"
            onClick={onOpenProject}
            status="3 项待完成"
            updated="12 分钟前"
          />
          <ProjectCard
            code="毕"
            description="文献阅读与周报"
            monogram="green"
            name="毕业设计"
            status="草稿已保存"
            updated="昨天"
          />
          <ProjectCard
            code="SR"
            description="材料与时间线"
            monogram="blue"
            name="暑研申请"
            status="1 项待确认"
            updated="9 月 8 日"
          />
        </div>
      </section>
      <section className={styles.taskStrip}>
        <div>
          <span className={styles.taskStateIcon}>◷</span>
          <div>
            <strong>检查 Lab 1 报告缺项</strong>
            <p>Agent 正等待你确认修改</p>
          </div>
        </div>
        <Button className={styles.taskAction} onClick={onOpenProject} variant="quiet">
          打开任务
        </Button>
      </section>
    </div>
  );
}
