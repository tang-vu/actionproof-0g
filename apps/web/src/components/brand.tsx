import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="ActionProof home">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span>ActionProof</span>
    </Link>
  );
}
