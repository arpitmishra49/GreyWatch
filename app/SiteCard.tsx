import Link from "next/link";
import { BoltIcon, AlertTriangleIcon, MailIcon, ArrowRightIcon } from "./icons";

export interface SiteCardData {
  id: string;
  name: string;
  slug: string;
  activeTaskCount: number;
  breachedCount: number;
  activeEmailTaskCount: number;
  redZone: boolean;
  f90: boolean;
}

export function SiteCard({ site }: { site: SiteCardData }) {
  const breached = site.breachedCount > 0;

  return (
    <Link href={`/sites/${site.slug}`} className="site-card" title={site.name}>
      <div className="site-card-top">
        <span className="site-card-name">{site.name}</span>
        <ArrowRightIcon className="site-card-arrow" />
      </div>

      {/* Always rendered, even with no flags, so this row's height is
          reserved and every card in the grid stays the same height. */}
      <div className="site-card-flags">
        {site.redZone && (
          <span className="badge badge-redzone">
            <span className="dot" aria-hidden="true"></span>
            Red Zone
          </span>
        )}
        {site.f90 && <span className="badge badge-f90">F90</span>}
      </div>

      <div className="site-card-metrics">
        <div className={`metric-chip slack${site.activeTaskCount > 0 ? " active" : ""}`}>
          <BoltIcon className="metric-chip-icon" />
          <span className="metric-chip-value">{site.activeTaskCount}</span>
          <span className="metric-chip-label">Slack</span>
        </div>
        <div className={`metric-chip breach${breached ? " critical" : ""}`}>
          <AlertTriangleIcon className="metric-chip-icon" />
          <span className="metric-chip-value">{site.breachedCount}</span>
          <span className="metric-chip-label">Breached</span>
        </div>
        <div className={`metric-chip email${site.activeEmailTaskCount > 0 ? " active" : ""}`}>
          <MailIcon className="metric-chip-icon" />
          <span className="metric-chip-value">{site.activeEmailTaskCount}</span>
          <span className="metric-chip-label">Email</span>
        </div>
      </div>

      <div className="site-card-footer">
        View site
        <ArrowRightIcon size={12} />
      </div>
    </Link>
  );
}
