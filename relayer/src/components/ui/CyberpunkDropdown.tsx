import { Listbox, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import { Fragment } from "react";

export interface DropdownOption {
  value: string | number;
  label: string;
}

export interface CyberpunkDropdownProps {
  value: string | number;
  onChange: (value: string | number) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
}

export function CyberpunkDropdown({
  value,
  onChange,
  options,
  placeholder = "Select...",
  className = "",
}: CyberpunkDropdownProps) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Listbox value={value} onChange={onChange}>
      <div className={`relative ${className}`}>
        <Listbox.Button className="w-full p-4 bg-gray-900/70 border-2 border-gray-600/50 rounded-xl text-white font-mono text-sm focus:border-cyan-400 focus:shadow-lg focus:shadow-cyan-400/30 transition-all backdrop-blur-sm text-left cursor-pointer hover:border-gray-500/50">
          <span className="block truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
            <ChevronDownIcon
              className="h-5 w-5 text-cyan-400"
              aria-hidden="true"
            />
          </span>
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute z-50 mt-2 max-h-60 w-full overflow-auto rounded-xl bg-gray-900/95 border-2 border-cyan-400/50 backdrop-blur-xl shadow-lg shadow-cyan-400/30 focus:outline-none text-sm font-mono">
            {options.map((option) => (
              <Listbox.Option
                key={option.value}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-3 px-4 transition-all duration-200 ${
                    active
                      ? "bg-cyan-400/20 text-cyan-300 shadow-lg shadow-cyan-400/20"
                      : "text-gray-300 hover:bg-gray-800/50"
                  }`
                }
                value={option.value}
              >
                {({ selected }) => (
                  <span
                    className={`block truncate ${
                      selected ? "font-bold text-cyan-300" : "font-normal"
                    }`}
                  >
                    {option.label}
                  </span>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}
