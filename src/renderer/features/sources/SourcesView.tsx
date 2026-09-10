import clsx from 'clsx';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import styles from './SourcesView.module.css';

const courseItems = [
  { name: '机器学习 · Lab 1', meta: '9 月 12 日截止' },
  { name: '计算机网络 · Assignment 2', meta: '9 月 18 日截止' },
  { name: '人工智能 · 课程通知', meta: '昨天更新' },
];

export function SourcesView() {
  return (
    <div className="page">
      <PageHeader
        actions={
          <Button className={styles.headerPrimary} variant="primary">
            ↻ 刷新
          </Button>
        }
        eyebrow="校园资料"
        title="资料"
      />
      <div className={styles.sourcesLayout}>
        <section className={styles.sourceCategories}>
          <button className={clsx(styles.sourceCategory, styles.isActive)} type="button">
            <span>▤</span>
            <div>
              <strong>课程</strong>
              <small>3 门课程</small>
            </div>
          </button>
          <button className={styles.sourceCategory} type="button">
            <span>✉</span>
            <div>
              <strong>邮箱</strong>
              <small>需要重新登录</small>
            </div>
          </button>
        </section>
        <section className={styles.sourceList}>
          <div className={styles.listHeading}>
            <p className="panel-label">课程内容</p>
            <span>示例数据</span>
          </div>
          {courseItems.map((item, index) => (
            <button
              className={clsx(styles.sourceListItem, index === 0 && styles.isSelected)}
              key={item.name}
              type="button"
            >
              <strong>{item.name}</strong>
              <span>{item.meta}</span>
            </button>
          ))}
        </section>
        <article className={styles.sourceDetail}>
          <p className="eyebrow">Canvas · 作业</p>
          <h2>Lab 1: Classification</h2>
          <div className={styles.detailDate}>
            <span>截止时间</span>
            <strong>9 月 12 日 23:59</strong>
          </div>
          <p className={styles.detailCopy}>
            完成分类模型训练、结果分析与实验报告。报告需包含数据预处理、参数选择和误差讨论。
          </p>
          <div className={styles.detailActions}>
            <Button variant="quiet">打开原文</Button>
            <Button variant="primary">加入项目</Button>
          </div>
        </article>
      </div>
    </div>
  );
}
