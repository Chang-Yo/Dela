import clsx from 'clsx';
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { StatusDot } from '../../components/StatusDot';
import { CodeBlock } from './CodeBlock';
import styles from './ProjectView.module.css';

const projectItems = ['概览', '实验要求', 'slides.pdf', 'notes.md', '检查清单'];
const documentTabs = ['概览', 'notes.md', '检查清单'];

function itemIcon(index: number) {
  return index === 0 ? '⌂' : index < 3 ? '◇' : '□';
}

type ProjectViewProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
};

export function ProjectView({ activeTab, onTabChange }: ProjectViewProps) {
  const [agentWidth, setAgentWidth] = useState(340);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  const resizeAgent = (event: PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    setAgentWidth(Math.min(520, Math.max(280, start.width + start.x - event.clientX)));
  };

  return (
    <div className={styles.projectPage}>
      <PageHeader
        actions={
          <>
            <Button className={styles.headerQuiet} variant="quiet">
              打开文件夹
            </Button>
            <Button className={styles.headerPrimary} variant="primary">
              在 VS Code 中打开
            </Button>
          </>
        }
        className={styles.pageHeader}
        eyebrow="项目 / 机器学习"
        title="Lab 1"
      />
      <div
        className={styles.projectLayout}
        style={{ '--agent-width': `${agentWidth}px` } as CSSProperties}
      >
        <aside className={styles.itemsPanel}>
          <p className="panel-label">项目内容</p>
          {projectItems.map((item, index) => (
            <button
              className={clsx(styles.itemLink, item === activeTab && styles.isSelected)}
              key={item}
              onClick={() => onTabChange(item)}
              type="button"
            >
              <span aria-hidden="true">{itemIcon(index)}</span>
              {item}
            </button>
          ))}
          <button className={styles.addSourceButton} type="button">
            ＋ 添加资料
          </button>
        </aside>
        <section className={styles.documentPanel}>
          <div className={styles.documentTabs} role="tablist">
            {documentTabs.map((tab) => (
              <button
                className={clsx(activeTab === tab && styles.isActive)}
                key={tab}
                onClick={() => onTabChange(tab)}
                role="tab"
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>
          <div className={styles.documentContent}>
            <div className={styles.documentKicker}>
              <StatusDot tone="amber" />
              项目概览
            </div>
            <h2>完成实验、核对要求并按时提交</h2>
            <p className={styles.documentLead}>
              围绕实验要求整理资料、记录结果，并在提交前完成一次完整检查。
            </p>
            <div className={styles.documentStatGrid}>
              <div>
                <span>截止时间</span>
                <strong>9 月 12 日 23:59</strong>
              </div>
              <div>
                <span>当前进度</span>
                <strong>60% · 3 项完成</strong>
              </div>
            </div>
            <div className={styles.checklistBlock}>
              <div className={styles.contentSectionHeading}>
                <h3>下一步</h3>
                <Button size="sm" variant="quiet">
                  编辑
                </Button>
              </div>
              <label className={clsx(styles.checkRow, styles.isDone)}>
                <input defaultChecked type="checkbox" />
                <span>完成模型训练与记录</span>
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" />
                <span>补充误差分析图表</span>
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" />
                <span>核对报告命名与提交格式</span>
              </label>
            </div>
            <div className={styles.linkedSources}>
              <h3>已关联资料</h3>
              <div className={styles.sourceChip}>
                <span>PDF</span>
                <div>
                  <strong>Lab1_requirements.pdf</strong>
                  <small>Canvas · 今天 10:30</small>
                </div>
              </div>
              <div className={styles.sourceChip}>
                <span>DIR</span>
                <div>
                  <strong>D:\Courses\ML\Lab1</strong>
                  <small>本地文件夹</small>
                </div>
              </div>
            </div>
          </div>
        </section>
        <div
          aria-label="调整 Agent 面板宽度"
          className={styles.agentResizeHandle}
          onPointerDown={(event) => {
            resizeStart.current = { x: event.clientX, width: agentWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={resizeAgent}
          onPointerUp={(event) => {
            resizeStart.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          role="separator"
          tabIndex={0}
        />
        <aside className={styles.agentPanel}>
          <div className={styles.agentHeader}>
            <div>
              <p className="panel-label">Agent</p>
              <strong>检查报告</strong>
            </div>
            <button className={styles.iconButton} type="button">
              ＋
            </button>
          </div>
          <div className={styles.conversation}>
            <div className={styles.userMessage}>帮我对照实验要求，检查报告还缺什么。</div>
            <div className={styles.agentMessage}>
              <span className={styles.agentAvatar}>D</span>
              <div>
                <p>已阅读实验要求和当前报告，发现两处待补充内容。</p>
                <CodeBlock
                  code={'# 按课程要求提交实验报告\npython submit.py --lab 1 --report report.pdf'}
                  language="bash"
                />
                <div className={styles.stepSummary}>
                  <span>✓</span> 已完成 2 个读取步骤
                </div>
                <button className={styles.inlineAction} type="button">
                  查看检查结果 →
                </button>
              </div>
            </div>
          </div>
          <div className={styles.agentComposer}>
            <div className={styles.contextRow}>
              <span>上下文 · 3 项资料</span>
              <button type="button">管理</button>
            </div>
            <div className={styles.composerBox}>
              <textarea aria-label="发送给 Agent" placeholder="继续询问…" rows={3} />
              <button className={styles.sendButton} title="发送" type="button">
                ↑
              </button>
            </div>
            <small>资料仅在你发送请求时提供给模型</small>
          </div>
        </aside>
      </div>
    </div>
  );
}
