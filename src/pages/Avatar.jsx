/* stickman avatar, drawn as an inline SVG (no images, no storage).
   Everything about it is derived from the user id, so each person always gets the same one:
   hat (none / cap / beanie / spiky hair), idle pose (arms down / wave / cheer) and background colour.
   While studying he holds a book, on a break he holds a cup.
   Status ring: focus (pulsing indigo) · break (pulsing green) · online (steady green) · offline (dimmed) */
function Stickman({ n, status }) {
  const hat = Math.floor(n / 3) % 4;
  const pose = Math.floor(n / 11) % 3;
  const IDLE_ARMS = ['M20 20L13 26M20 20L27 26', 'M20 20L13 26M20 20L27 13', 'M20 20L13 13M20 20L27 13'];
  const soft = { fill: 'currentColor', fillOpacity: 0.25 };
  return (
    <svg
      viewBox="0 0 40 40"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* body + legs */}
      <path d="M20 17V27M20 27L14 35M20 27L26 35" />

      {/* arms (and what he is holding) */}
      {status === 'focus' ? (
        <>
          <path d="M20 20L15 25M20 20L25 25" />
          <rect x="14" y="23" width="12" height="7" rx="1.2" strokeWidth="1.6" {...soft} />
          <path d="M20 23V30" strokeWidth="1.2" />
        </>
      ) : status === 'break' ? (
        <>
          <path d="M20 20L13 26M20 20L26 22" />
          <path d="M25 15h6v5.5a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" strokeWidth="1.5" {...soft} />
        </>
      ) : (
        <path d={IDLE_ARMS[pose]} />
      )}

      {/* head + face */}
      <circle cx="20" cy="12" r="5" />
      <circle cx="18.2" cy="11.3" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="21.8" cy="11.3" r="0.9" fill="currentColor" stroke="none" />
      {status === 'focus'
        ? <path d="M18.6 14.2H21.4" strokeWidth="1.1" />
        : <path d="M18 13.5Q20 15.4 22 13.5" strokeWidth="1.1" />}

      {/* hat */}
      {hat === 1 && (
        <>
          <path d="M14.8 10.5A5.4 5.4 0 0 1 25.2 10.5Z" strokeWidth="1.6" {...soft} />
          <path d="M25 10.5H30" strokeWidth="1.8" />
        </>
      )}
      {hat === 2 && (
        <>
          <path d="M14.6 9.5Q20 2 25.4 9.5Z" strokeWidth="1.6" {...soft} />
          <circle cx="20" cy="4.4" r="1.3" fill="currentColor" stroke="none" />
        </>
      )}
      {hat === 3 && <path d="M17.5 7.2L16.5 4.2M20 6.8V3.6M22.5 7.2L23.5 4.2" strokeWidth="1.6" />}
    </svg>
  );
}

export function Avatar({ name, id, status }) {
  const n = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span
      className={`st-avatar${status ? ` ring-${status}` : ''}`}
      style={{ '--h': n % 360 }}
      role="img"
      aria-label={name}
    >
      <Stickman n={n} status={status} />
    </span>
  );
}
