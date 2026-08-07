import { Link } from "react-router-dom";


import { SkeletonLine } from "./bookshelf";
import { ArrowLeftIcon } from "./icons";

export const BookDetailSkeleton = () => (
  <div aria-busy="true" className="page page-narrow stack-lg">
    <div className="detail-page-header">
      <Link className="backlink" to="/">
        <ArrowLeftIcon />
        Bookshelf
      </Link>
    </div>

    <section aria-hidden="true" className="detail-hero">
      <div className="detail-cover-clickable">
        <div className="book-cover book-cover-large">
          <div className="skeleton-block skeleton-cover" />
        </div>
      </div>
      <div className="detail-identity stack-md">
        <div className="stack-xs">
          <SkeletonLine className="skeleton-line-heading" />
          <SkeletonLine className="skeleton-line-author" />
          <SkeletonLine className="skeleton-line-meta" />
        </div>

        <div className="send-card">
          <div className="send-card-header">
            <div className="send-card-title">
              <span className="skeleton-circle" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
            <span className="skeleton-pill" />
          </div>
          <div className="send-recipient-display">
            <div className="send-recipient-info">
              <SkeletonLine className="skeleton-line-eyebrow" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
            <div className="skeleton-button skeleton-button-sm" />
          </div>
          <div className="send-card-actions">
            <div className="skeleton-button" />
          </div>
        </div>

        <SkeletonLine className="skeleton-line-small" />
      </div>
    </section>

    <section aria-hidden="true" className="panel stack-sm">
      <div className="section-heading">
        <SkeletonLine className="skeleton-line-section" />
      </div>
      <dl className="about-grid">
        {Array.from({ length: 6 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholders; position is the only identity
          <div key={`book-detail-about-skeleton-${index}`}>
            <dt>
              <SkeletonLine className="skeleton-line-eyebrow" />
            </dt>
            <dd>
              <SkeletonLine
                className={
                  index === 3 ? "skeleton-line-meta" : "skeleton-line-medium"
                }
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>

    <section aria-hidden="true" className="panel stack-sm">
      <div className="section-heading">
        <SkeletonLine className="skeleton-line-section" />
        <SkeletonLine className="skeleton-line-small" />
      </div>
      <div className="history-list">
        {Array.from({ length: 3 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholders; position is the only identity
          <div className="history-row" key={`delivery-history-skeleton-${index}`}>
            <div className="history-row-main">
              <span className="skeleton-pill" />
              <div className="history-row-text">
                <SkeletonLine className="skeleton-line-medium" />
                <SkeletonLine className="skeleton-line-small" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section aria-hidden="true" className="panel danger-zone-card">
      <div className="danger-zone-content">
        <div className="stack-xs skeleton-flex-fill">
          <SkeletonLine className="skeleton-line-eyebrow" />
          <SkeletonLine className="skeleton-line-paragraph" />
        </div>
        <div className="skeleton-button skeleton-button-secondary" />
      </div>
    </section>
  </div>
);

export const SettingsSkeleton = () => (
  <div aria-busy="true" className="page page-narrow stack-lg">
    <section aria-hidden="true" className="panel stack-md">
      <div className="stack-xs">
        <SkeletonLine className="skeleton-line-heading" />
        <SkeletonLine className="skeleton-line-paragraph" />
        <SkeletonLine className="skeleton-line-medium" />
      </div>

      <div className="stack-sm">
        <div className="stack-xs">
          <SkeletonLine className="skeleton-line-label" />
          <div className="skeleton-input" />
        </div>
        <div className="inline-actions" aria-hidden="true">
          <div className="skeleton-button" />
          <div className="skeleton-button skeleton-button-secondary" />
        </div>
      </div>
    </section>
  </div>
);

