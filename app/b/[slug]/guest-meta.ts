/**
 * Descripción de la tarjeta de WhatsApp. Solo promete confirmar cuando el
 * enlace lo permite de verdad: enlace personal válido y abierto. El enlace
 * general (el que se reenvía al grupo de la familia), uno revocado o uno con
 * el plazo cerrado no tienen formulario: solo se consultan los detalles.
 */
export function guestPageDescription(partnerName1: string, partnerName2: string, canConfirm: boolean): string {
  return canConfirm
    ? `Consulta los detalles de la boda y confirma tu asistencia a ${partnerName1} y ${partnerName2} sin crear una cuenta.`
    : `Consulta los detalles de la boda de ${partnerName1} y ${partnerName2}.`;
}
