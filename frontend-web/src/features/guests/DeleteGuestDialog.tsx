import { toast } from 'sonner'
import { errorMessage } from '@/api/errorMessage'
import { useDeleteGuest } from '@/api/guests'
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
import type { Guest } from '@/domain/types'

type DeleteGuestDialogProps = { guest: Guest; onClose: () => void }

export function DeleteGuestDialog({ guest, onClose }: DeleteGuestDialogProps) {
  const remove = useDeleteGuest()

  async function confirm() {
    try {
      await remove.mutateAsync(guest.id)
      toast.success(`Usunięto: ${guest.displayName}.`)
      onClose()
    } catch (failure) {
      toast.error(errorMessage(failure))
      onClose()
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunąć gościa {guest.displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Gość zniknie z listy, ze swoich powiązań i z miejsc przy stołach. Jeśli ktoś po prostu
            nie przyjdzie, lepiej go wyłączyć: wróci jednym kliknięciem.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault() // stay open until the server answered
              void confirm()
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Usuń gościa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
