import Link from "next/link";

export function NavLinks() {
  return (
    <div className="nav-links">
      <Link className="nav-link" href="/tasks">
        Tasks
      </Link>
      <Link className="nav-link" href="/tasks/new">
        New Task
      </Link>
    </div>
  );
}
