import { Workflow } from './index';

export const unloadPackageWorkflow: Workflow = {
  id: 'unload_package',
  title: 'Unload Package',
  subtitle: 'Follow the steps to unload the package from the drone',
  steps: [
    {
      id: 'verify_drone',
      type: 'checklist',
      title: 'Verify Drone Arrival',
      instruction:
        'Confirm the drone has safely arrived and is ready for unloading:',
      items: [
        { id: 'drone_landed', label: 'Drone has landed completely' },
        { id: 'propeller_off', label: 'Propeller has stopped spinning' },
        { id: 'led_blue', label: 'Drone LED is showing blue' },
      ],
      nextLabel: 'All Confirmed',
    },
    {
      id: 'scan_receiver_qr',
      type: 'qr_scan',
      title: 'Scan Receiver QR',
      instruction:
        'Scan the QR code from the receiver to verify their identity.',
      hint: 'Ask the receiver to open their QR code in the Drovery app',
      nextLabel: "I've Scanned the QR",
    },
    {
      id: 'open_box',
      type: 'drone_button',
      title: 'Open Drone Box',
      instruction: 'Press the drone button to open the storage box.',
      icon: 'lock-open-outline',
      nextLabel: 'Box is Open',
    },
    {
      id: 'take_package',
      type: 'instruction',
      title: 'Take Package Out',
      instruction:
        'Carefully remove the package from the drone storage box. Verify the package matches the delivery details.',
      icon: 'cube-outline',
      iconColor: '#F59E0B',
      nextLabel: 'Package Removed',
    },
    {
      id: 'close_confirm',
      type: 'drone_button',
      title: 'Close & Confirm',
      instruction:
        'Close the drone box and press the drone button to confirm unloading is complete.',
      icon: 'checkmark-circle-outline',
      nextLabel: 'Done',
    },
  ],
};
