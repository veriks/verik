export function setupSignalForwarding(childKill: (signal: NodeJS.Signals) => void): () => void {
  const onSigint = () => childKill('SIGINT');
  const onSigterm = () => childKill('SIGTERM');

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  return () => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  };
}
