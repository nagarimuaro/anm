import React, { useEffect } from 'react';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
  ShieldCheckIcon
} from '../Icons';

/**
 * StatusDialog — Modal dialog terstandar untuk respon gagal / kendala / sukses
 * 
 * Props:
 * - isOpen: boolean
 * - type: 'error' | 'warning' | 'success' | 'info' (default 'error')
 * - title: string
 * - message: string
 * - onClose: () => void
 * - actionText: string (default 'Coba Lagi' / 'Mengerti')
 * - onAction: () => void
 * - secondaryActionText: string (opsional, misal 'Kembali ke Beranda')
 * - onSecondaryAction: () => void
 * - autoCloseMs: number (opsional)
 */
const StatusDialog = ({
  isOpen,
  type = 'error',
  title,
  message,
  onClose,
  actionText,
  onAction,
  secondaryActionText,
  onSecondaryAction,
  autoCloseMs,
}) => {
  useEffect(() => {
    if (!isOpen || !autoCloseMs || autoCloseMs <= 0) return;
    const timer = setTimeout(() => {
      if (onClose) onClose();
    }, autoCloseMs);
    return () => clearTimeout(timer);
  }, [isOpen, autoCloseMs, onClose]);

  if (!isOpen) return null;

  const defaultTitles = {
    error: 'Gagal Memproses Permintaan',
    warning: 'Peringatan Sistem',
    success: 'Operasi Berhasil',
    info: 'Informasi',
  };

  const displayTitle = title || defaultTitles[type] || 'Pemberitahuan';
  const displayActionText = actionText || (type === 'error' ? 'Tutup' : 'Mengerti');

  const renderIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircleIcon size={44} color="#10B981" />;
      case 'warning':
        return <AlertTriangleIcon size={44} color="#F59E0B" />;
      case 'info':
        return <InfoIcon size={44} color="#38BDF8" />;
      case 'error':
      default:
        return <AlertTriangleIcon size={44} color="#EF4444" />;
    }
  };

  return (
    <div className="status-dialog-backdrop" onClick={onClose}>
      <div
        className={`status-dialog-box ${type}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={`status-dialog-icon-circle ${type}`}>
          {renderIcon()}
        </div>

        <h3 className="status-dialog-title">{displayTitle}</h3>
        
        <p className="status-dialog-message">
          {message || 'Terjadi kesalahan saat menghubungi server. Silakan periksa koneksi atau coba beberapa saat lagi.'}
        </p>

        <div className="status-dialog-actions">
          {secondaryActionText && (
            <button
              type="button"
              className="btn btn-secondary status-dialog-btn"
              onClick={onSecondaryAction || onClose}
            >
              {secondaryActionText}
            </button>
          )}

          <button
            type="button"
            className={`btn ${type === 'error' ? 'btn-danger' : 'btn-primary'} status-dialog-btn`}
            onClick={onAction || onClose}
            autoFocus
          >
            {displayActionText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatusDialog;
