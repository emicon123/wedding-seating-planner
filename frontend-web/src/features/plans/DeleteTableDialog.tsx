import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { peopleLabel } from '@/domain/labels'

type DeleteTableDialogProps = {
  tableNumber: number
  guestCount: number
  onConfirm: () => void
  onClose: () => void
}

export function DeleteTableDialog({
  tableNumber,
  guestCount,
  onConfirm,
  onClose,
}: DeleteTableDialogProps) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunąć stół {tableNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            {guestCount > 0
              ? `${peopleLabel(guestCount)} z tego stołu trafi do pola „Bez stołu”. `
              : 'Stół jest pusty. '}
            Pinezki z tego stołu znikną, a późniejsze stoły dostaną numery o jeden niższe.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Usuń stół
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
